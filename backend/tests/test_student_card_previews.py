from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
import os

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.entities import AuditLog, Notification, StudentCardPreview, StudentCardReference, User, UserRole
from app.services import student_card_previews as previews
from app.services.student_identity_profile import update_profile, verify_profile


class PreviewStorageTests(TestCase):
    def setUp(self):
        self.directory = self.enterContext(TemporaryDirectory())
        self.root = Path(self.directory) / 'previews'
        self.enterContext(patch.object(previews, 'PREVIEW_ROOT', self.root))
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        self.addCleanup(self.engine.dispose)

        @event.listens_for(self.engine, 'connect')
        def setup(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)

        User.__table__.create(self.engine)
        StudentCardPreview.__table__.create(self.engine)
        StudentCardReference.__table__.create(self.engine)
        from tests.schema_helpers import install_avatar_foreign_key
        with self.engine.begin() as connection:
            install_avatar_foreign_key(connection)
        AuditLog.__table__.create(self.engine)
        with self.engine.begin() as connection:
            connection.exec_driver_sql('CREATE TABLE exams (id CHAR(32) PRIMARY KEY)')
            connection.exec_driver_sql('CREATE TABLE exam_attempts (id CHAR(32) PRIMARY KEY)')
        from app.models.entities import SupportConversation
        SupportConversation.__table__.create(self.engine)
        Notification.__table__.create(self.engine)
        self.db = self.enterContext(Session(self.engine, expire_on_commit=False, autoflush=False))
        self.user = self.make_student('001IT123')
        self.other = self.make_student('001IT124')
        self.admin = User(id=uuid4(), full_name='Synthetic Admin', email='admin@example.test', password_hash='unused', role=UserRole.admin, is_active=True)
        self.db.add(self.admin)
        self.db.commit()
        self.enterContext(patch.dict(app.dependency_overrides, {get_db: lambda: self.db}))
        self.client = self.enterContext(TestClient(app))

    def make_student(self, code):
        user = User(id=uuid4(), full_name='Nguyễn Văn Thiện', email=f'{code}@example.test', password_hash='unused', role=UserRole.student, is_active=True,
                    student_code=code, identity_profile_status='VERIFIED', identity_verified_at=datetime.now(timezone.utc))
        self.db.add(user)
        return user

    def create(self, **overrides):
        args = dict(original=b'synthetic-original', card=b'synthetic-card-jpeg', face=b'synthetic-face-jpeg',
                    extracted={'full_name': 'Nguyễn Văn Thiện', 'student_code': self.user.student_code},
                    validation={'can_confirm': True}, ocr_model_version='test-ocr-only', parser_version='test-parser', matching_version='test-matching')
        return previews.create_preview(self.db, self.user.id, self.user.identity_profile_version, **(args | overrides))

    def headers(self, user=None):
        user = user or self.user
        return {'Authorization': f'Bearer {create_access_token(str(user.id), user.role.value)}'}

    def url(self, row, kind='card'):
        return f'/api/v1/identity/student-card/previews/{row.id}/{kind}'

    def test_private_storage_metadata_and_ten_minute_ttl(self):
        row = self.create()
        self.assertEqual(previews.utc(row.expires_at) - previews.utc(row.created_at), timedelta(minutes=10))
        self.assertEqual(row.identity_profile_version, self.user.identity_profile_version)
        self.assertEqual(len(row.image_sha256), 64)
        self.assertEqual(row.status, 'PENDING')
        self.assertEqual(self.user.student_card_status, 'NOT_SUBMITTED')
        self.assertEqual(previews.private_path(row.original_image_key).read_bytes(), b'synthetic-original')
        self.assertEqual(len(list(self.root.rglob('*.*'))), 3)

    def test_images_require_auth_role_ownership_and_use_no_store(self):
        row = self.create()
        for headers, expected in (({}, 401), (self.headers(self.admin), 403), (self.headers(self.other), 404), (self.headers(), 200)):
            response = self.client.get(self.url(row), headers=headers)
            self.assertEqual(response.status_code, expected)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
            self.assertNotIn(str(self.root), response.text)
        response = self.client.get(self.url(row, 'face'), headers=self.headers())
        self.assertEqual(response.content, b'synthetic-face-jpeg')
        self.assertEqual(response.headers['content-type'], 'image/jpeg')
        self.assertEqual(self.client.get(self.url(row, 'original'), headers=self.headers()).status_code, 422)

    def test_bearer_and_cookie_disagree_owner_is_bearer(self):
        row = self.create()
        self.client.cookies.set('auth_token', create_access_token(str(self.user.id), 'student'))
        self.assertEqual(self.client.get(self.url(row), headers=self.headers(self.other)).status_code, 404)
        self.client.cookies.set('auth_token', create_access_token(str(self.other.id), 'student'))
        self.assertEqual(self.client.get(self.url(row), headers=self.headers()).status_code, 200)

    def test_unverified_and_disabled_students_cannot_read_or_create(self):
        row = self.create()
        self.user.identity_profile_status = 'PENDING'
        self.db.commit()
        response = self.client.get(self.url(row), headers=self.headers())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['code'], 'PROFILE_NOT_VERIFIED')
        with self.assertRaises(HTTPException):
            self.create()
        self.user.is_active = False
        self.db.commit()
        self.assertEqual(self.client.get(self.url(row), headers=self.headers()).status_code, 401)

    def test_superseding_does_not_deactivate_a_verified_card(self):
        self.user.student_card_status = 'VERIFIED'
        self.db.commit()
        first = self.create()
        second = self.create()
        self.assertEqual(self.user.student_card_status, 'VERIFIED')
        self.assertEqual(self.db.get(StudentCardPreview, first.id).status, 'SUPERSEDED')
        response = self.client.get(self.url(first), headers=self.headers())
        self.assertEqual(response.json()['error']['code'], 'PREVIEW_SUPERSEDED')
        self.assertFalse(previews.private_path(first.original_image_key).exists())
        self.assertEqual(self.client.get(self.url(second), headers=self.headers()).status_code, 200)

    def test_expiry_blocks_access_at_exact_boundary_then_cleanup_purges_all(self):
        row = self.create()
        with self.assertRaises(HTTPException) as raised:
            previews.load_preview(self.db, row.id, self.user, now=previews.utc(row.expires_at))
        self.assertEqual(raised.exception.detail['code'], 'PREVIEW_EXPIRED')
        self.assertEqual(previews.cleanup_previews(self.db, now=previews.utc(row.expires_at)), 1)
        self.assertIsNone(self.db.get(StudentCardPreview, row.id))
        self.assertFalse(previews.private_path(row.original_image_key).exists())
        self.assertEqual(self.user.student_card_status, 'NOT_SUBMITTED')

    def test_profile_changes_invalidate_preview_and_stale_ocr_snapshot(self):
        row = self.create()
        update_profile(self.db, self.user, {'full_name': 'Nguyễn Văn An'})
        self.db.commit()
        self.assertEqual(self.db.get(StudentCardPreview, row.id).status, 'INVALIDATED')
        verify_profile(self.user, self.admin, self.user.identity_profile_version)
        self.db.commit()
        response = self.client.get(self.url(row), headers=self.headers())
        self.assertEqual(response.json()['error']['code'], 'PROFILE_CHANGED')
        with self.assertRaises(HTTPException) as raised:
            previews.create_preview(self.db, self.user.id, row.identity_profile_version, original=b'x', card=b'x', face=b'x', extracted={}, validation={}, ocr_model_version='test', parser_version='test', matching_version='test')
        self.assertEqual(raised.exception.detail['code'], 'PROFILE_CHANGED')

    def test_database_failure_preserves_previous_pending_files_and_status(self):
        first = self.create()
        with patch.object(self.db, 'commit', side_effect=SQLAlchemyError('synthetic storage failure')):
            with self.assertRaises(HTTPException) as raised:
                self.create()
            self.assertEqual(raised.exception.detail['code'], 'PREVIEW_SAVE_FAILED')
        self.assertEqual(self.db.get(StudentCardPreview, first.id).status, 'PENDING')
        self.assertTrue(previews.private_path(first.original_image_key).exists())
        self.assertEqual(len(list(self.root.iterdir())), 1)

    def test_file_failure_rolls_back_superseding_and_removes_partial_files(self):
        first = self.create()
        with patch.object(Path, 'open', side_effect=OSError('synthetic disk full')):
            with self.assertRaises(HTTPException) as raised:
                self.create()
            self.assertEqual(raised.exception.detail['code'], 'PREVIEW_SAVE_FAILED')
        self.assertEqual(self.db.get(StudentCardPreview, first.id).status, 'PENDING')
        self.assertEqual(len(list(self.root.iterdir())), 1)
        self.assertTrue(previews.private_path(first.original_image_key).exists())

    def test_cleanup_commit_failure_never_removes_files(self):
        row = self.create()
        with patch.object(self.db, 'commit', side_effect=RuntimeError('synthetic commit failure')):
            with self.assertRaises(RuntimeError):
                previews.cleanup_previews(self.db, now=previews.utc(row.expires_at))
        self.db.rollback()
        self.assertIsNotNone(self.db.get(StudentCardPreview, row.id))
        self.assertTrue(previews.private_path(row.original_image_key).exists())

    def test_crash_orphan_sweep_preserves_recent_files(self):
        old, recent = uuid4(), uuid4()
        for preview_id in (old, recent):
            path = previews.private_path(f'{preview_id.hex}/original.bin')
            path.parent.mkdir(parents=True)
            path.write_bytes(b'synthetic-orphan')
        before = (datetime.now(timezone.utc) - timedelta(minutes=11)).timestamp()
        os.utime(previews.private_path(f'{old.hex}/original.bin').parent, (before, before))
        self.assertEqual(previews.cleanup_previews(self.db), 1)
        self.assertFalse(previews.private_path(f'{old.hex}/original.bin').exists())
        self.assertTrue(previews.private_path(f'{recent.hex}/original.bin').exists())

    def test_invalid_keys_and_cross_preview_keys_are_rejected(self):
        first = self.create()
        second = self.create()
        second.card_preview_key = first.card_preview_key
        self.db.commit()
        self.assertEqual(self.client.get(self.url(second), headers=self.headers()).status_code, 404)
        for key in ('../secret', 'C:/secret', '/etc/passwd', f'{second.id.hex}/../../secret', f'{second.id.hex}/card.jpg?token=x'):
            with self.assertRaises(HTTPException):
                previews.private_path(key)

    def test_partial_unique_index_rejects_two_pending_records(self):
        row = self.create()
        values = {column.name: getattr(row, column.name) for column in StudentCardPreview.__table__.columns}
        values['id'] = uuid4()
        self.db.add(StudentCardPreview(**values))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_private_storage_is_not_publicly_mounted(self):
        row = self.create()
        for prefix in ('/private/identity/previews/', '/uploads/identity/previews/'):
            self.assertEqual(self.client.get(prefix + row.card_preview_key).status_code, 404)
