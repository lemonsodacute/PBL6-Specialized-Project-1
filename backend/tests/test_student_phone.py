from unittest import TestCase
from unittest.mock import patch
from sqlalchemy.exc import SQLAlchemyError
from tests import test_student_identity_profile as fixture
from app.api.v1 import auth


class StudentPhoneTests(TestCase):
    setUp = fixture.StudentIdentityProfileTests.setUp
    make_user = fixture.StudentIdentityProfileTests.make_user
    headers = fixture.StudentIdentityProfileTests.headers
    update = fixture.StudentIdentityProfileTests.update
    verify = fixture.StudentIdentityProfileTests.verify

    def save(self, body, actor=None):
        return self.client.patch('/api/v1/auth/me', headers=self.headers(actor or self.student), json=body)

    def test_save_trim_preserve_leading_zero_and_persist(self):
        for phone in ('0901234567', '+84901234567', '0012345678'):
            result = self.save({'phone': f'  {phone}  '})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['user']['phone'], phone)
            self.db.expire_all()
            profile = self.client.get('/api/v1/auth/me', headers=self.headers(self.student)).json()['user']
            self.assertEqual(profile['phone'], phone)
            self.assertIsNone(self.other.phone)

    def test_clear_and_invalid_input(self):
        self.save({'phone': '0901234567'})
        for value in (None, '', '   '):
            self.assertIsNone(self.save({'phone': value}).json()['user']['phone'])
        for value in ('abc', '1234567', '1'*16, '++84901234567', '090 123 4567', '090-1234567', '１２３４５６７８', 901234567, {}, ['0901234567']):
            self.assertEqual(self.save({'phone': value}).status_code, 422, repr(value))
        self.assertEqual(self.save({}).status_code, 422)

    def test_auth_roles_and_disabled_account(self):
        self.assertEqual(self.client.patch('/api/v1/auth/me', json={'phone': None}).status_code, 401)
        self.assertEqual(self.save({'phone': None}, self.admin).status_code, 403)
        self.student.is_active = False
        self.db.commit()
        self.assertEqual(self.save({'phone': None}).status_code, 401)

    def test_teacher_updates_only_own_phone_without_role_or_identity_changes(self):
        before = (self.teacher.role, self.teacher.identity_profile_version, self.teacher.identity_profile_status)
        result = self.save({'phone': '0012345678'}, self.teacher)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['user']['phone'], '0012345678')
        self.assertEqual((self.teacher.role, self.teacher.identity_profile_version, self.teacher.identity_profile_status), before)
        self.assertIsNone(self.student.phone)
        for field, value in {'role': 'admin', 'user_id': str(self.other.id), 'avatar_url': '/injected.png'}.items():
            self.assertEqual(self.save({'phone': '0901234567', field: value}, self.teacher).status_code, 422)

    def test_mass_assignment_and_other_user_denied(self):
        for field, value in {'user_id': str(self.other.id), 'student_id': str(self.other.id), 'full_name': 'Injected name', 'student_code': '001IT123', 'role': 'admin', 'identity_profile_status': 'VERIFIED', 'identity_profile_version': 9, 'identity_verified_at': '2026-10-09T00:00:00Z', 'identity_verified_by': str(self.admin.id), 'student_card_status': 'VERIFIED'}.items():
            self.assertEqual(self.save({'phone': '0901234567', field: value}).status_code, 422)
        self.assertEqual(self.client.patch(f'/api/v1/users/{self.other.id}', headers=self.headers(self.student), json={'phone': '0901234567'}).status_code, 403)
        self.assertIsNone(self.student.phone)
        self.assertIsNone(self.other.phone)

    def test_verified_profile_provenance_and_version_unchanged(self):
        self.update(student_code='001IT123')
        self.verify()
        self.student.student_card_status = 'VERIFIED'
        self.db.commit()
        fields = ('identity_profile_status', 'identity_profile_version', 'identity_verified_at', 'identity_verified_by', 'student_card_status')
        before = tuple(getattr(self.student, field) for field in fields)
        for value in ('0901234567', '+84901234567', None):
            self.assertEqual(self.save({'phone': value}).status_code, 200)
            self.assertEqual(tuple(getattr(self.student, field) for field in fields), before)

    def test_failed_save_rolls_back_and_does_not_expose_internal_details(self):
        with patch.object(auth, 'record_audit', side_effect=SQLAlchemyError('secret SQL stack')):
            result = self.save({'phone': '0901234567'})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('secret SQL stack', result.text)
        self.db.expire_all()
        self.assertIsNone(self.student.phone)
