from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1 import auth
from app.models.entities import AuditLog
from app.services import teacher_avatar
from app.services.audit import record_audit
from tests import test_student_identity_profile as fixture


class TeacherProfileTests(TestCase):
    make_user = fixture.StudentIdentityProfileTests.make_user
    headers = fixture.StudentIdentityProfileTests.headers

    def setUp(self):
        fixture.StudentIdentityProfileTests.setUp(self)
        self.storage = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.object(teacher_avatar, 'AVATAR_ROOT', Path(self.storage)))
        self.enterContext(patch.object(auth, 'record_audit', wraps=record_audit))

    def save(self, body, actor=None):
        return self.client.patch('/api/v1/auth/me', headers=self.headers(actor or self.teacher), json=body)

    def image(self, format='PNG'):
        output = BytesIO()
        Image.new('RGB', (120, 80), '#28777b').save(output, format=format)
        return output.getvalue()

    def upload(self, content=None, mime='image/png', profile=None, actor=None, extra=None):
        return self.client.post('/api/v1/auth/me/avatar', headers=self.headers(actor or self.teacher),
            files={'avatar': ('../../untrusted-name.png', self.image() if content is None else content, mime)},
            data={'profile': json.dumps(profile or {}), **(extra or {})})

    def test_personal_fields_persist_on_same_user_and_admin_sees_updates(self):
        before = self.teacher.identity_profile_version
        response = self.save({'full_name': '  Nguyễn Minh Anh  ', 'phone': '  +84901234567  '})
        self.assertEqual(response.status_code, 200, response.text)
        self.db.expire_all()
        profile = self.client.get('/api/v1/auth/me', headers=self.headers(self.teacher)).json()['user']
        self.assertEqual(profile['full_name'], 'Nguyễn Minh Anh')
        self.assertEqual(profile['phone'], '+84901234567')
        self.assertEqual(profile['identity_profile_version'], before)
        admin_view = self.client.get(f'/api/v1/users/{self.teacher.id}', headers=self.headers()).json()['data']
        self.assertEqual(admin_view['full_name'], profile['full_name'])
        self.assertEqual(admin_view['phone'], profile['phone'])
        self.assertEqual(self.save({'full_name': 'Tên mới'}).status_code, 200)
        self.assertEqual(self.teacher.phone, '+84901234567')
        self.assertIsNone(self.save({'phone': '   '}).json()['user']['phone'])
        logs = self.db.scalars(select(AuditLog).where(AuditLog.action == 'PROFILE_UPDATED')).all()
        self.assertEqual(logs[0].metadata_json, {'fields': ['full_name', 'phone']})

    def test_privilege_owner_and_role_boundaries(self):
        original = self.teacher.full_name
        for key, value in {'role': 'admin', 'status': 'active', 'is_active': False, 'is_admin': True,
            'teacher_code': 'GV123', 'user_id': str(self.other.id), 'email': 'other@example.test',
            'avatar_url': '/injected.jpg', 'avatar_source': 'TEACHER_UPLOAD'}.items():
            response = self.save({'full_name': 'Valid name', key: value})
            self.assertEqual(response.status_code, 422, (key, response.text))
        self.assertEqual(self.teacher.full_name, original)
        self.assertEqual(self.save({'full_name': 'Changed'}, self.student).status_code, 422)
        self.assertEqual(self.save({'phone': None}, self.admin).status_code, 403)
        self.assertEqual(self.client.patch('/api/v1/auth/me', json={'full_name': 'Changed'}).status_code, 401)
        self.assertEqual(self.client.patch(f'/api/v1/users/{self.other.id}', headers=self.headers(self.teacher), json={'full_name': 'Changed'}).status_code, 403)
        response = self.client.patch('/api/v1/auth/me?user_id=' + str(self.other.id), headers=self.headers(self.teacher), json={'full_name': 'Own profile'})
        self.assertEqual(response.json()['user']['id'], str(self.teacher.id))
        self.assertNotEqual(self.other.full_name, 'Own profile')
        self.teacher.is_active = False; self.db.commit()
        self.assertEqual(self.save({'full_name': 'Changed'}).status_code, 401)
        self.assertEqual(self.upload().status_code, 401)

    def test_validation_is_atomic_and_rejects_whitespace_null_and_invalid_phone(self):
        before = self.teacher.full_name
        for value in ('', '   ', None, 'x', 'x' * 256, 123):
            self.assertEqual(self.save({'full_name': value}).status_code, 422)
        for phone in ('abc', '1234567', '1234567890123456', '090 123 4567'):
            self.assertEqual(self.save({'full_name': 'Valid name', 'phone': phone}).status_code, 422)
        self.assertEqual(self.teacher.full_name, before)
        self.assertEqual(self.save({}).status_code, 422)

    def test_avatar_is_sanitized_private_owner_or_admin_only_and_replaced(self):
        response = self.upload(profile={'full_name': 'Avatar owner', 'phone': '0901234567'})
        self.assertEqual(response.status_code, 200, response.text)
        profile = response.json()['user']; url = profile['avatar_url']
        self.assertEqual(profile['full_name'], 'Avatar owner')
        self.assertEqual(profile['avatar_source'], 'TEACHER_UPLOAD')
        self.assertIsNone(profile['avatar_reference_id'])
        self.assertIsNotNone(profile['avatar_updated_at'])
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get(url, headers=self.headers(self.student)).status_code, 403)
        other_teacher = self.make_user('teacher'); self.db.commit()
        self.assertEqual(self.client.get(url, headers=self.headers(other_teacher)).status_code, 403)
        photo = self.client.get(url, headers=self.headers(self.teacher))
        self.assertEqual(photo.status_code, 200)
        self.assertEqual(photo.headers['cache-control'], 'no-store')
        self.assertEqual(photo.headers['x-content-type-options'], 'nosniff')
        self.assertEqual(photo.headers['content-type'], 'image/jpeg')
        with Image.open(BytesIO(photo.content)) as image:
            self.assertEqual(image.size, (512, 512))
            self.assertFalse(image.getexif())
        self.assertEqual(self.client.get(url, headers=self.headers()).content, photo.content)
        admin_view = self.client.get(f'/api/v1/users/{self.teacher.id}', headers=self.headers()).json()['data']
        self.assertEqual(admin_view['avatar_url'], url)
        newer = self.upload(self.image('JPEG'), 'image/jpeg')
        self.assertEqual(newer.status_code, 200, newer.text)
        self.assertNotEqual(newer.json()['user']['avatar_url'], url)
        self.assertEqual(self.client.get(url, headers=self.headers(self.teacher)).status_code, 404)
        self.assertEqual(len(list(Path(self.storage).rglob('*.jpg'))), 1)
        log = self.db.scalars(select(AuditLog).where(AuditLog.action == 'PROFILE_UPDATED')).first()
        self.assertEqual(log.metadata_json, {'fields': ['full_name', 'phone', 'avatar']})

    def test_avatar_rejects_spoofing_oversize_decode_and_unauthorized_fields(self):
        for content, mime in ((b'not an image', 'image/png'), (self.image(), 'image/jpeg'),
            (self.image(), 'image/svg+xml'), (self.image()[:40], 'image/png'),
            (b'x' * (teacher_avatar.MAX_AVATAR_BYTES + 1), 'image/png')):
            self.assertEqual(self.upload(content, mime).status_code, 422)
        for field in ('role', 'teacher_code', 'user_id', 'avatar_url'):
            self.assertEqual(self.upload(profile={field: 'injected'}).status_code, 422)
            self.assertEqual(self.upload(extra={field: 'injected'}).status_code, 422)
        self.assertEqual(self.upload(profile={'full_name': ' '}).status_code, 422)
        self.assertEqual(self.upload(actor=self.student).status_code, 403)
        self.assertEqual(self.upload(actor=self.admin).status_code, 403)
        self.assertIsNone(self.teacher.avatar_url)
        self.assertEqual(list(Path(self.storage).rglob('*.jpg')), [])

    def test_failed_avatar_save_preserves_previous_photo_and_personal_fields(self):
        old = self.upload().json()['user']['avatar_url']
        name = self.teacher.full_name
        with patch.object(teacher_avatar, 'record_audit', side_effect=SQLAlchemyError('private SQL')):
            response = self.upload(profile={'full_name': 'Should roll back', 'phone': '0901234567'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private SQL', response.text)
        self.db.expire_all()
        self.assertEqual(self.teacher.avatar_url, old)
        self.assertEqual(self.teacher.full_name, name)
        self.assertIsNone(self.teacher.phone)
        self.assertEqual(self.client.get(old, headers=self.headers(self.teacher)).status_code, 200)
        self.assertEqual(len(list(Path(self.storage).rglob('*.jpg'))), 1)
