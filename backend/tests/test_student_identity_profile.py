from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1 import auth, users
from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token
from app.main import app
from app.models.entities import AuditLog, Notification, ProfileVerificationRequest, StudentCardPreview, StudentCardReference, StudentFaceEmbedding, User, UserRole, UserSettings
from app.services.student_identity_profile import update_profile


class StudentIdentityProfileTests(TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        self.addCleanup(self.engine.dispose)

        @event.listens_for(self.engine, 'connect')
        def setup(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)

        User.__table__.create(self.engine)
        UserSettings.__table__.create(self.engine)
        ProfileVerificationRequest.__table__.create(self.engine)
        with self.engine.begin() as connection:
            connection.exec_driver_sql('CREATE TABLE exams (id CHAR(32) PRIMARY KEY)')
            connection.exec_driver_sql('CREATE TABLE exam_attempts (id CHAR(32) PRIMARY KEY)')
        from app.models.entities import SupportConversation
        SupportConversation.__table__.create(self.engine)
        Notification.__table__.create(self.engine)
        StudentCardPreview.__table__.create(self.engine)
        StudentCardReference.__table__.create(self.engine)
        StudentFaceEmbedding.__table__.create(self.engine)
        AuditLog.__table__.create(self.engine)
        self.db = self.enterContext(Session(self.engine, expire_on_commit=False, autoflush=False))
        self.admin, self.student, self.other, self.teacher = [self.make_user(role) for role in ('admin', 'student', 'student', 'teacher')]
        self.db.commit()
        self.enterContext(patch.dict(app.dependency_overrides, {get_db: lambda: self.db}))
        self.audit = self.enterContext(patch.object(users, 'record_audit'))
        self.enterContext(patch.object(auth, 'record_audit'))
        self.client = self.enterContext(TestClient(app))

    def make_user(self, role):
        user = User(id=uuid4(), full_name='Nguyễn Văn Thiện', email=f'{uuid4()}@example.com', password_hash='unused', role=UserRole(role), is_active=True)
        self.db.add(user)
        return user

    def headers(self, user=None):
        user = user or self.admin
        return {'Authorization': f'Bearer {create_access_token(str(user.id), user.role.value)}'}

    def update(self, user=None, **values):
        return self.client.patch(f'/api/v1/users/{self.student.id}', headers=self.headers(user), json=values)

    def verify(self, user=None, version=None):
        return self.client.post(f'/api/v1/users/{self.student.id}/identity-profile/verify', headers=self.headers(user), json={'identity_profile_version': version or self.student.identity_profile_version})

    def test_registration_defaults_and_rejects_authoritative_fields(self):
        data = {'full_name': 'Sinh viên mới', 'email': 'new@example.com', 'password': 'synthetic-password'}
        for field, value in {'student_code': '21IT123', 'identity_profile_status': 'VERIFIED', 'identity_verified_by': str(self.admin.id), 'student_id': str(self.student.id)}.items():
            self.assertEqual(self.client.post('/api/v1/auth/register', json={**data, field: value}).status_code, 422)
        response = self.client.post('/api/v1/auth/register', json=data)
        self.assertEqual(response.status_code, 200)
        profile = self.client.get('/api/v1/auth/me').json()['user']
        self.assertTrue(profile['is_active'])
        self.assertIsNone(profile['student_code'])
        self.assertEqual(profile['identity_profile_status'], 'PENDING')
        self.assertEqual(profile['identity_profile_version'], 1)
        self.assertEqual(profile['student_card_status'], 'NOT_SUBMITTED')

    def test_only_admin_may_set_code_or_verify(self):
        for actor in (self.student, self.teacher):
            self.assertEqual(self.update(actor, student_code='21IT123').status_code, 403)
            self.assertEqual(self.verify(actor).status_code, 403)
        self.assertEqual(self.client.patch(f'/api/v1/users/{self.student.id}', json={'student_code': '21IT123'}).status_code, 401)
        self.assertEqual(self.client.patch('/api/v1/auth/me', headers=self.headers(self.student), json={'student_code': '21IT123'}).status_code, 422)

    def test_admin_normalizes_code_preserves_leading_zero_and_verifies_with_provenance(self):
        response = self.update(student_code='  001it123  ')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['student_code'], '001IT123')
        self.assertEqual(response.json()['data']['identity_profile_version'], 2)
        result = self.verify().json()['data']
        self.assertEqual(result['identity_profile_status'], 'VERIFIED')
        self.assertEqual(result['identity_verified_by'], str(self.admin.id))
        self.assertIsNotNone(result['identity_verified_at'])
        self.assertNotIn('password_hash', result)
        self.assertEqual(self.verify().json()['data']['identity_verified_at'], result['identity_verified_at'])
        self.assertEqual(self.audit.call_args.kwargs['action'], 'student_identity_profile_verified')

    def test_code_unique_in_api_and_database(self):
        self.other.student_code = '21IT123'
        self.db.commit()
        response = self.update(student_code=' 21it123 ')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'STUDENT_CODE_EXISTS')
        self.student.student_code = '21IT123'
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_verified_profile_change_requires_reverification_and_increments_once(self):
        self.update(student_code='21IT123')
        self.verify()
        self.student.student_card_status = 'VERIFIED'
        self.db.commit()
        version = self.student.identity_profile_version
        result = self.update(full_name='Nguyễn Văn An', student_code='21IT124').json()['data']
        self.assertEqual(result['identity_profile_version'], version + 1)
        self.assertEqual(result['identity_profile_status'], 'PENDING')
        self.assertIsNone(result['identity_verified_at'])
        self.assertIsNone(result['identity_verified_by'])
        self.assertEqual(result['student_card_status'], 'NEEDS_REUPLOAD')
        stale = self.verify(version=version)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['error']['code'], 'PROFILE_CHANGED')

    def test_phone_and_noop_updates_do_not_invalidate(self):
        self.update(student_code='21IT123')
        self.verify()
        version = self.student.identity_profile_version
        result = self.update(phone='0901234567', full_name=self.student.full_name, student_code=' 21it123 ').json()['data']
        self.assertEqual(result['identity_profile_status'], 'VERIFIED')
        self.assertEqual(result['identity_profile_version'], version)

    def test_disable_and_role_changes_revoke_identity(self):
        self.update(student_code='21IT123')
        self.verify()
        response = self.client.delete(f'/api/v1/users/{self.student.id}', headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['identity_profile_status'], 'PENDING')
        self.assertEqual(self.verify().status_code, 409)
        result = self.update(role='teacher').json()['data']
        self.assertIsNone(result['student_code'])
        self.assertEqual(result['identity_profile_status'], 'PENDING')

    def test_incomplete_profile_and_untrusted_fields_rejected(self):
        # An administrator may approve the name before a card supplies MSSV.
        self.assertEqual(self.verify().status_code, 200)
        self.assertIsNone(self.student.student_code)
        for values in ({'identity_profile_status': 'VERIFIED'}, {'student_code': 123}, {'student_code': ' '}, {'full_name': ' '}, {'full_name': None}, {'role': None}, {'is_active': None}):
            with self.subTest(values=values):
                self.assertEqual(self.update(**values).status_code, 422)
        result = self.client.post(f'/api/v1/users/{self.student.id}/identity-profile/verify', headers=self.headers(), json={'identity_profile_version': 1, 'full_name': 'Injected'})
        self.assertEqual(result.status_code, 422)

    def test_nonstudent_cannot_receive_code(self):
        response = self.client.patch(f'/api/v1/users/{self.teacher.id}', headers=self.headers(), json={'student_code': '21IT123'})
        self.assertEqual(response.status_code, 422)

    def test_rollback_preserves_verified_profile(self):
        self.update(student_code='21IT123')
        self.verify()
        version = self.student.identity_profile_version
        update_profile(self.db, self.student, {'full_name': 'Tên thay đổi'})
        self.db.flush()
        self.db.rollback()
        self.assertEqual(self.student.identity_profile_status, 'VERIFIED')
        self.assertEqual(self.student.identity_profile_version, version)

    def test_bearer_wins_over_cookie_for_me_and_admin_requests(self):
        self.client.cookies.set('auth_token', create_access_token(str(self.admin.id), 'admin'))
        response = self.client.get('/api/v1/auth/me', headers=self.headers(self.student))
        self.assertEqual(response.json()['user']['id'], str(self.student.id))
        self.assertEqual(self.update(self.student, student_code='21IT123').status_code, 403)
        self.client.cookies.set('auth_token', create_access_token(str(self.student.id), 'student'))
        self.assertEqual(self.update(student_code='21IT123').status_code, 200)

    def test_invalid_bearer_never_falls_back_to_shared_cookie(self):
        self.client.cookies.set('auth_token', create_access_token(str(self.admin.id), 'admin'))
        for value in ('Bearer invalid', 'Bearer ', 'Basic invalid', ''):
            self.assertEqual(self.client.get('/api/v1/auth/me', headers={'Authorization': value}).status_code, 401)
        self.assertEqual(self.client.get('/api/v1/auth/me').json()['user']['id'], str(self.admin.id))

    def test_refresh_never_switches_a_tab_to_the_cookie_account(self):
        self.client.cookies.set('refresh_token', create_refresh_token(str(self.admin.id)))
        response = self.client.post('/api/v1/auth/refresh', headers=self.headers(self.student))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error']['code'], 'SESSION_ACCOUNT_MISMATCH')
        self.assertNotIn('set-cookie', response.headers)
        self.client.cookies.set('refresh_token', create_refresh_token(str(self.student.id)))
        response = self.client.post('/api/v1/auth/refresh', headers=self.headers(self.student))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['id'], str(self.student.id))
