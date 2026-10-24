from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.api.v1.auth import _public_user
from app.main import app
from app.models.entities import User, UserRole


class UserProfileTests(TestCase):
    def setUp(self):
        self.user = User(id=uuid4(), full_name='Synthetic student', email='student@example.test',
                         password_hash='never-return-this', role=UserRole.student, phone='0901234567',
                         avatar_url='/uploads/student.jpg', is_active=True,
                         created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
                         identity_profile_status='PENDING', identity_profile_version=1,
                         student_card_status='NOT_SUBMITTED')

    def test_me_returns_only_public_profile_fields(self):
        with patch.dict(app.dependency_overrides, {get_current_user: lambda: self.user}), TestClient(app) as client:
            response = client.get('/api/v1/auth/me')
        self.assertEqual(response.status_code, 200)
        user = response.json()['user']
        self.assertEqual(set(user), {'id', 'full_name', 'email', 'role', 'phone', 'avatar_url', 'is_active', 'created_at',
                                    'student_code', 'class_name', 'identity_profile_status', 'identity_profile_version',
                                    'identity_verified_at', 'student_card_status', 'avatar_source', 'avatar_reference_id', 'avatar_updated_at'})
        self.assertEqual(user['id'], str(self.user.id))
        self.assertIsNone(user['avatar_url'])  # An unverified student's legacy public image is not a trusted card avatar.
        self.assertEqual(user['phone'], '0901234567')
        self.assertEqual(user['created_at'], '2026-01-02T00:00:00Z')
        self.assertNotIn('never-return-this', response.text)

    def test_optional_profile_fields_can_be_null(self):
        self.user.phone = self.user.avatar_url = None
        with patch.dict(app.dependency_overrides, {get_current_user: lambda: self.user}), TestClient(app) as client:
            response = client.get('/api/v1/auth/me')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['user']['phone'])
        self.assertIsNone(response.json()['user']['avatar_url'])

    def test_query_parameters_cannot_select_another_student(self):
        with patch.dict(app.dependency_overrides, {get_current_user: lambda: self.user}), TestClient(app) as client:
            response = client.get('/api/v1/auth/me', params={'student_id': str(uuid4()), 'user_id': str(uuid4())})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['id'], str(self.user.id))

    def test_me_requires_authentication(self):
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/v1/auth/me').status_code, 401)

    def test_login_user_payload_remains_unchanged(self):
        self.assertEqual(set(_public_user(self.user)), {'id', 'full_name', 'email', 'role'})
