from unittest import TestCase
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1 import auth
from app.core.database import get_db
from app.core.security import decode_access_token, hash_password, verify_password
from app.main import app
from app.models.entities import User, UserRole


class AuthAccountTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = 'synthetic-password'
        cls.password_hash = hash_password(cls.password)

    def setUp(self):
        self.db = MagicMock(spec=Session)
        self.user = User(id=uuid4(), full_name='Synthetic Student', email='student@example.com',
                         password_hash=self.password_hash, role=UserRole.student, is_active=True)
        self.db.scalar.return_value = self.user
        self.enterContext(patch.dict(app.dependency_overrides, {get_db: lambda: self.db}))
        self.enterContext(patch.dict(auth._failed_logins, {}, clear=True))
        self.enterContext(patch.object(auth, 'record_audit'))
        self.client = self.enterContext(TestClient(app))

    def login(self, **values):
        return self.client.post('/api/v1/auth/login', json={
            'email': self.user.email, 'password': self.password, **values,
        })

    def register(self, **values):
        return self.client.post('/api/v1/auth/register', json={
            'full_name': 'Synthetic Student', 'email': 'new@example.com',
            'password': self.password, **values,
        })

    def test_inactive_account_with_correct_password_gets_no_session(self):
        self.user.is_active = False
        response = self.login()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['code'], 'ACCOUNT_DISABLED')
        self.assertNotIn('access_token', response.json())
        self.assertNotIn('set-cookie', response.headers)
        self.db.commit.assert_not_called()
        self.assertIsNone(self.user.last_login_at)

    def test_wrong_password_does_not_disclose_whether_account_is_disabled(self):
        self.user.is_active = False
        disabled = self.login(password='wrong-password')
        self.user.is_active = True
        active = self.login(password='wrong-password')
        self.db.scalar.return_value = None
        missing = self.login(password='wrong-password')
        for response in (disabled, active, missing):
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()['error']['code'], 'INVALID_CREDENTIALS')
            self.assertNotIn('set-cookie', response.headers)
        self.assertEqual(disabled.json(), active.json())
        self.assertEqual(active.json(), missing.json())

    def test_login_normalizes_email_like_registration(self):
        response = self.login(email='STUDENT@EXAMPLE.COM')
        self.assertEqual(response.status_code, 200)
        query = self.db.scalar.call_args.args[0]
        self.assertIn('student@example.com', query.compile().params.values())
        self.assertIn('lower(users.email)', str(query))

    def test_login_uses_stored_role_and_returns_public_user_only(self):
        for role in UserRole:
            with self.subTest(role=role):
                self.user.role = role
                response = self.login(role='admin' if role != UserRole.admin else 'student')
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertEqual(payload['user']['role'], role.value)
                self.assertEqual(set(payload['user']), {'id', 'full_name', 'email', 'role'})
                claims = decode_access_token(payload['access_token'])
                self.assertEqual(claims['role'], role.value)
                self.assertEqual(claims['sub'], str(self.user.id))
                self.assertNotIn(self.password_hash, response.text)
                self.assertTrue(all('HttpOnly' in cookie for cookie in response.headers.get_list('set-cookie')))

    def test_public_registration_rejects_client_role(self):
        for role in ('admin', 'teacher', 'student', 'superuser'):
            with self.subTest(role=role):
                response = self.register(role=role)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()['error']['code'], 'VALIDATION_ERROR')
                self.assertNotIn('set-cookie', response.headers)
        self.db.add.assert_not_called()
        self.db.commit.assert_not_called()

    def test_registration_rejects_blank_or_too_short_trimmed_name(self):
        for name in ('', '    ', '\t\n', ' A '):
            with self.subTest(name=name):
                self.assertEqual(self.register(full_name=name).status_code, 422)
        self.db.add.assert_not_called()

    def test_registration_trims_name_hashes_password_and_auto_logs_in_student(self):
        self.db.scalar.return_value = None
        self.db.refresh.side_effect = lambda user: setattr(user, 'id', uuid4())
        response = self.register(full_name='  Synthetic Student  ', email='NEW@EXAMPLE.COM')
        self.assertEqual(response.status_code, 200)
        saved = self.db.add.call_args.args[0]
        self.assertEqual(saved.full_name, 'Synthetic Student')
        self.assertEqual(saved.email, 'new@example.com')
        self.assertEqual(saved.role, UserRole.student)
        self.assertNotEqual(saved.password_hash, self.password)
        self.assertTrue(verify_password(self.password, saved.password_hash))
        self.assertEqual(response.json()['user']['role'], 'student')
        self.assertEqual(response.json()['user']['full_name'], 'Synthetic Student')
        self.assertEqual(decode_access_token(response.json()['access_token'])['role'], 'student')
        self.assertIsNotNone(saved.last_login_at)
        self.assertIn('set-cookie', response.headers)

    def test_duplicate_email_returns_public_error_without_creation(self):
        response = self.register()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'EMAIL_EXISTS')
        self.db.add.assert_not_called()
        self.db.commit.assert_not_called()
        self.assertNotIn('set-cookie', response.headers)

    def test_backend_revalidates_email_and_password_length(self):
        invalid = ({'email': 'not-an-email'}, {'password': 'short'}, {'password': 'a' * 129})
        for values in invalid:
            with self.subTest(values=list(values)):
                self.assertEqual(self.register(**values).status_code, 422)
                self.assertEqual(self.login(**values).status_code, 422)
        self.db.add.assert_not_called()
        self.db.commit.assert_not_called()

    def test_existing_minimum_password_does_not_require_extra_character_classes(self):
        self.db.scalar.return_value = None
        self.db.refresh.side_effect = lambda user: setattr(user, 'id', uuid4())
        self.assertEqual(self.register(password='abcdefgh').status_code, 200)

    def test_failed_login_rate_limit_still_applies(self):
        for _ in range(5):
            self.assertEqual(self.login(password='wrong-password').status_code, 401)
        response = self.login()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['error']['code'], 'RATE_LIMITED')
        self.assertNotIn('set-cookie', response.headers)
