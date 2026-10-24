"""Opt-in PostgreSQL integration tests using a disposable, uniquely named DB.

Run with IDENTITY_TEST_POSTGRES=1. The configured application DB is never
migrated by these tests; only its server credentials are used.
"""
import json
import os
from pathlib import Path
import re
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from scripts.migrate_identity import migrate
from app.services import student_card_previews as previews

BACKEND = Path(__file__).resolve().parents[1]


def schema_snapshot(engine):
    with engine.connect() as connection:
        inspector = inspect(connection)
        result = {}
        for table in sorted(inspector.get_table_names()):
            if table == 'alembic_version':
                continue
            result[table] = {
                'columns': [{k: str(v) if k == 'type' else v for k, v in col.items() if k in ('name', 'type', 'nullable', 'default')} for col in inspector.get_columns(table)],
                'pk': inspector.get_pk_constraint(table)['constrained_columns'],
                'unique': sorted([sorted(item['column_names']) for item in inspector.get_unique_constraints(table)]),
                'fk': sorted([{k: v for k, v in item.items() if k not in ('name', 'referred_schema')} for item in inspector.get_foreign_keys(table)], key=str),
                'checks': sorted([item['sqltext'] for item in inspector.get_check_constraints(table)]),
                'indexes': sorted([{k: v for k, v in item.items() if k in ('name', 'column_names', 'unique')} for item in inspector.get_indexes(table)], key=str),
            }
        return result


@skipUnless(os.environ.get('IDENTITY_TEST_POSTGRES') == '1', 'Set IDENTITY_TEST_POSTGRES=1 for isolated PostgreSQL tests')
class IdentityMigrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.name = f'ai_procto_identity_test_{uuid4().hex}'
        cls.control = create_engine(settings.DATABASE_URL, isolation_level='AUTOCOMMIT')
        with cls.control.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{cls.name}"'))
        cls.addClassCleanup(cls.cleanup_database)
        cls.engine = create_engine(cls.control.url.set(database=cls.name))
        cls.addClassCleanup(cls.engine.dispose)
        cls.config = Config(str(BACKEND / 'alembic.ini'))
        cls.config.set_main_option('script_location', str(BACKEND / 'alembic'))
        cls.settings_patch = patch.object(settings, 'DATABASE_URL', cls.engine.url.render_as_string(hide_password=False))
        cls.settings_patch.start()
        cls.addClassCleanup(cls.settings_patch.stop)

    @classmethod
    def cleanup_database(cls):
        if not re.fullmatch(r'ai_procto_identity_test_[0-9a-f]{32}', cls.name):
            raise RuntimeError('Refusing to remove an unexpected test database')
        with cls.control.connect() as connection:
            # Only this uniquely named disposable DB; close late pooled test
            # connections as well, so a successful round-trip leaves no DB.
            connection.execute(text(f'DROP DATABASE "{cls.name}" WITH (FORCE)'))
        cls.control.dispose()

    def test_upgrade_downgrade_preserves_legacy_data_and_validates_profile(self):
        # The frozen 0001 currently reads a schema.sql that already creates the
        # 0005 table. Verify equivalence in this empty scratch DB before stamp.
        command.upgrade(self.config, '0004_notifications')
        for name, table in (('0005_student_identities', 'student_identities'), ('0006_identity_verifications', 'identity_verifications')):
            legacy_schema = schema_snapshot(self.engine)[table]
            revision = ScriptDirectory.from_config(self.config).get_revision(name).module
            with self.engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
                revision.downgrade()
                revision.upgrade()
            self.assertEqual(legacy_schema, schema_snapshot(self.engine)[table])
        command.stamp(self.config, '0006_identity_verifications')
        reference = schema_snapshot(self.engine)
        actual = schema_snapshot(self.control)
        differences = {table: {'actual': actual.get(table), 'expected': expected} for table, expected in reference.items() if actual.get(table) != expected}
        report = BACKEND.parent / 'artifacts' / 'identity-schema-audit.json'
        report.parent.mkdir(exist_ok=True)
        report.write_text(json.dumps({'missing_tables': sorted(set(reference) - set(actual)), 'extra_tables': sorted(set(actual) - set(reference)), 'differences': differences}, indent=2, default=str), encoding='utf-8')
        student_id = uuid4()
        with self.engine.begin() as connection:
            connection.execute(text("INSERT INTO users (id, full_name, email, password_hash, role) VALUES (:id, 'Legacy student', 'legacy@example.test', 'unused', 'student')"), {'id': student_id})
            connection.execute(text("INSERT INTO student_identities (student_id, front_image_path) VALUES (:id, '/private/identity/synthetic.jpg')"), {'id': student_id})
        # Reproduce the audited application DB: unversioned and missing two
        # historical tables. Only this uniquely named test DB is modified.
        scripts = ScriptDirectory.from_config(self.config)
        with self.engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
            scripts.get_revision('0004_notifications').module.downgrade()
            scripts.get_revision('0006_identity_verifications').module.downgrade()
            connection.execute(text('DROP TABLE alembic_version'))
            connection.execute(text('ALTER TABLE users ADD COLUMN unexpected_drift integer'))
        with self.assertRaisesRegex(RuntimeError, 'Unrecognized schema drift'):
            migrate(apply=True)
        with self.engine.begin() as connection:
            self.assertFalse(inspect(connection).has_table('alembic_version'))
            self.assertFalse(inspect(connection).has_table('notifications'))
            connection.execute(text('ALTER TABLE users DROP COLUMN unexpected_drift'))
        self.assertFalse(migrate()['applied'])
        self.assertTrue(migrate(apply=True)['applied'])
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(text('select version_num from alembic_version')), ScriptDirectory.from_config(self.config).get_current_head())
            self.assertTrue(inspect(connection).has_table('student_face_embeddings'))
            user = connection.execute(text('select * from users where id=:id'), {'id': student_id}).mappings().one()
            self.assertEqual(user['identity_profile_status'], 'PENDING')
            self.assertEqual(user['identity_profile_version'], 1)
            self.assertEqual(user['student_card_status'], 'NOT_SUBMITTED')
            self.assertIsNone(user['student_code'])
            self.assertEqual(connection.scalar(text('select front_image_path from student_identities')), '/private/identity/synthetic.jpg')
        with self.engine.begin() as connection:
            connection.execute(text("UPDATE users SET student_code='001IT123', identity_profile_status='VERIFIED', identity_verified_at=now() WHERE id=:id"), {'id': student_id})
        with TemporaryDirectory() as directory, patch.object(previews, 'PREVIEW_ROOT', Path(directory) / 'previews'):
            def create_concurrently(_):
                with Session(self.engine, expire_on_commit=False) as db:
                    return previews.create_preview(db, student_id, 1, original=b'synthetic-original', card=b'synthetic-card', face=b'synthetic-face',
                        extracted={}, validation={}, ocr_model_version='test', parser_version='test', matching_version='test').id
            with ThreadPoolExecutor(max_workers=2) as workers:
                ids = list(workers.map(create_concurrently, range(2)))
            self.assertEqual(len(set(ids)), 2)
            with self.engine.connect() as connection:
                self.assertEqual(connection.scalar(text("SELECT count(*) FROM student_card_previews WHERE status='PENDING'")), 1)
                self.assertEqual(connection.scalar(text("SELECT count(*) FROM student_card_previews WHERE status='SUPERSEDED'")), 1)
        command.downgrade(self.config, '0008_student_identity_profile')
        with self.engine.connect() as connection:
            self.assertFalse(inspect(connection).has_table('student_card_previews'))
            self.assertEqual(connection.scalar(text('select count(*) from student_identities')), 1)
            self.assertTrue(inspect(connection).has_table('student_face_embeddings'))
        command.upgrade(self.config, '0009_student_card_previews')
        command.downgrade(self.config, '0007_student_face_embeddings')
        with self.engine.connect() as connection:
            self.assertNotIn('student_code', {column['name'] for column in inspect(connection).get_columns('users')})
            self.assertEqual(connection.scalar(text('select count(*) from users')), 1)
            self.assertEqual(connection.scalar(text('select count(*) from student_identities')), 1)
        command.upgrade(self.config, 'head')
        # Confirm races run against actual PostgreSQL row locks, not SQLite.
        from threading import Barrier
        from fastapi import HTTPException
        import numpy as np
        from app.models.entities import User, StudentCardReference, StudentFaceEmbedding
        from app.services import student_card_identity as cards
        from app.services.student_card_matching import PARSER_VERSION, MATCHING_VERSION
        from app.services.student_card_ocr import MODEL_VERSION
        with self.engine.begin() as connection:
            connection.execute(text("UPDATE users SET student_code='001IT123', identity_profile_status='VERIFIED', identity_verified_at=now() WHERE id=:id"), {'id': student_id})
        with TemporaryDirectory() as directory, patch.object(previews, 'PREVIEW_ROOT', Path(directory) / 'previews'):
            with Session(self.engine, expire_on_commit=False) as db:
                preview = previews.create_preview(db, student_id, 1, original=b'synthetic-original', card=b'synthetic-card', face=b'synthetic-face',
                    extracted={'full_name': 'Legacy student', 'student_code': '001IT123'}, confidence={'full_name': .99, 'student_code': .99},
                    validation={'can_confirm': True}, ocr_model_version=MODEL_VERSION, parser_version=PARSER_VERSION, matching_version=MATCHING_VERSION)
            barrier = Barrier(2)
            vector = np.zeros(128, dtype=np.float32)
            vector[0] = 1
            def infer(_, **kwargs):
                barrier.wait(timeout=10)
                return vector
            def confirm_concurrently(_):
                with Session(self.engine, expire_on_commit=False) as db:
                    try:
                        cards.confirm_card(db, db.get(User, student_id), preview.id)
                        return 200
                    except HTTPException as exc:
                        return exc.status_code
            with patch.object(cards, 'get_face_engine') as face, patch.object(cards, 'read_card_fields', return_value=(
                    {'full_name': 'Legacy student', 'student_code': '001IT123', 'class_name': None},
                    {'full_name': .99, 'student_code': .99})):
                face.return_value.extract_embedding.side_effect = infer
                with ThreadPoolExecutor(max_workers=2) as workers:
                    results = list(workers.map(confirm_concurrently, range(2)))
            # A successful confirmation increments card_admin_version. The
            # concurrent request must be rejected as a changed profile (409).
            self.assertEqual(sorted(results), [200, 409])
            with Session(self.engine) as db:
                refs = list(db.scalars(select(StudentCardReference)))
                self.assertEqual(len(refs), 1)
                self.assertEqual(db.scalar(select(StudentFaceEmbedding)).reference_version, refs[0].id)
            self.verify_exam_cutover(student_id)
        self.verify_profile_requests()

    def verify_profile_requests(self):
        from threading import Barrier
        from app.models.entities import User, UserRole, Notification, ProfileVerificationRequest
        from app.services.profile_requests import request_verification
        from sqlalchemy.exc import IntegrityError
        from datetime import datetime, timezone
        student_id, admin_id = uuid4(), uuid4()
        with Session(self.engine) as db:
            for user_id, role in ((student_id, UserRole.student), (admin_id, UserRole.admin)):
                db.add(User(id=user_id, full_name='Request fixture', email=f'{user_id}@example.test', role=role, password_hash='unused', is_active=True))
            db.commit()
        barrier = Barrier(2)
        def send(_):
            with Session(self.engine) as db:
                barrier.wait(timeout=10)
                request_verification(db, student_id)
                db.commit()
        with ThreadPoolExecutor(max_workers=2) as workers:
            list(workers.map(send, range(2)))
        with Session(self.engine) as db:
            self.assertEqual(len(list(db.scalars(select(ProfileVerificationRequest)))), 1)
            self.assertEqual(len(list(db.scalars(select(Notification).where(Notification.recipient_user_id == admin_id)))), 1)
            db.add(ProfileVerificationRequest(id=uuid4(), student_id=student_id, status='PENDING', requested_at=datetime.now(timezone.utc)))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()
            db.add(Notification(recipient_user_id=admin_id, type='exam_summary', title='Retained', message='Legacy notification'))
            db.commit()
        before = schema_snapshot(self.engine)
        command.downgrade(self.config, '0010_student_card_references')
        with self.engine.connect() as connection:
            self.assertFalse(inspect(connection).has_table('profile_verification_requests'))
            self.assertEqual(connection.scalar(text('SELECT count(*) FROM notifications WHERE recipient_user_id=:id'), {'id': admin_id}), 1)
            self.assertEqual(connection.scalar(text('SELECT title FROM notifications WHERE recipient_user_id=:id'), {'id': admin_id}), 'Retained')
        command.upgrade(self.config, 'head')
        self.assertEqual(schema_snapshot(self.engine), before)

    def verify_exam_cutover(self, student_id):
        from datetime import datetime, timedelta, timezone
        from fastapi.testclient import TestClient
        import numpy as np
        from app.main import app
        from app.core.database import get_db
        from app.core.security import create_access_token
        from app.api.v1 import identity
        from app.models.entities import User, UserRole, Exam, ExamAssignment, ExamStatus, IdentityVerification, StudentIdentity
        from app.services import student_card_identity as cards
        from app.services.face_recognition import compare_embeddings
        from app.services.student_card_matching import PARSER_VERSION, MATCHING_VERSION
        from app.services.student_card_ocr import MODEL_VERSION
        now = datetime.now(timezone.utc)
        exam_id, other_id = uuid4(), uuid4()
        with Session(self.engine) as db:
            db.add(User(id=other_id, full_name='Pending Student', email='pending@example.test', role=UserRole.student, password_hash='unused', is_active=True))
            db.add(Exam(id=exam_id, title='Synthetic identity exam', created_by=student_id, start_time=now-timedelta(hours=1), end_time=now+timedelta(hours=1), duration_minutes=30, require_camera=True, max_attempts=3, status=ExamStatus.published))
            db.flush()
            db.add_all([ExamAssignment(id=uuid4(), exam_id=exam_id, student_id=value) for value in (student_id, other_id)])
            db.commit()
        def database():
            with Session(self.engine, expire_on_commit=False) as db:
                yield db
        headers = {'Authorization': 'Bearer ' + create_access_token(str(student_id), 'student')}
        other_headers = {'Authorization': 'Bearer ' + create_access_token(str(other_id), 'student')}
        vector = np.zeros(128, dtype=np.float32)
        vector[0] = 1
        with patch.dict(app.dependency_overrides, {get_db: database}), patch.object(identity, 'get_face_engine') as engine, TestClient(app) as client:
            engine.return_value.extract_embedding.return_value = vector
            engine.return_value.compare_embeddings.side_effect = compare_embeddings
            def verify(auth=headers):
                return client.post(f'/api/v1/identity/exams/{exam_id}/verify', headers=auth,
                    data={'consent': 'true'}, files={'image': ('probe.jpg', b'synthetic-probe', 'image/jpeg')})
            def start(auth=headers):
                return client.post('/api/v1/attempts', headers=auth, json={'exam_id': str(exam_id)})
            self.assertEqual(verify(other_headers).json()['error']['code'], 'PROFILE_NOT_VERIFIED')
            self.assertEqual(start(other_headers).json()['error']['code'], 'PROFILE_NOT_VERIFIED')
            with Session(self.engine) as db:
                other = db.get(User, other_id)
                other.student_code, other.identity_profile_status, other.identity_verified_at = 'LEGACY001', 'VERIFIED', now
                db.add(StudentIdentity(student_id=other_id, front_image_path='/private/identity/legacy.jpg', status='verified'))
                db.commit()
            self.assertEqual(verify(other_headers).json()['error']['code'], 'REFERENCE_REQUIRED')
            self.assertEqual(start(other_headers).json()['error']['code'], 'REFERENCE_REQUIRED')
            result = verify()
            self.assertEqual(result.status_code, 200, result.text)
            self.assertTrue(result.json()['data']['verified'])
            engine.return_value.extract_embedding.assert_called_once_with(b'synthetic-probe')
            engine.return_value.compare_embeddings.assert_called_once()
            original_version = result.json()['data']['reference_version']
            # Contact-only edits must preserve every stored trust record and the
            # live exam verification, including a byte-identical face embedding.
            def trust_snapshot():
                with self.engine.connect() as connection:
                    return {table: [dict(row) for row in connection.execute(text(f'SELECT * FROM {table} WHERE student_id=:id'), {'id': student_id}).mappings()]
                            for table in ('student_card_references', 'student_face_embeddings', 'identity_verifications')}
            before_phone = trust_snapshot()
            old_profile = client.get('/api/v1/auth/me', headers=headers).json()['user']
            for phone in ('0901234567', '+84901234567', None):
                saved = client.patch('/api/v1/auth/me', headers=headers, json={'phone': phone})
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertEqual(saved.json()['user']['phone'], phone)
                for field in ('identity_profile_status', 'identity_profile_version', 'identity_verified_at', 'student_card_status'):
                    self.assertEqual(saved.json()['user'][field], old_profile[field])
                self.assertEqual(trust_snapshot(), before_phone)
                self.assertTrue(client.get(f'/api/v1/identity/exams/{exam_id}/status', headers=headers).json()['data']['verified'])
            with Session(self.engine) as db:
                record = db.scalar(select(IdentityVerification))
                self.assertEqual(str(record.reference_version), original_version)
                self.assertIsNone(record.image_path)
                user = db.get(User, student_id)
                preview = previews.create_preview(db, student_id, user.identity_profile_version, original=b'new-card', card=b'new-card', face=b'new-face',
                    extracted={'full_name': user.full_name, 'student_code': user.student_code}, confidence={'full_name': .99, 'student_code': .99}, validation={},
                    ocr_model_version=MODEL_VERSION, parser_version=PARSER_VERSION, matching_version=MATCHING_VERSION)
                preview_id = preview.id
            # Replace the reference after the verifier snapshots its template,
            # while DNN work is outside all locks. The pending verification fails.
            def change_reference(_):
                with Session(self.engine) as db, patch.object(cards, 'get_face_engine') as card_engine, patch.object(cards, 'read_card_fields', return_value=(
                        {'full_name': 'Legacy student', 'student_code': '001IT123', 'class_name': None},
                        {'full_name': .99, 'student_code': .99})):
                    card_engine.return_value.extract_embedding.return_value = vector
                    cards.confirm_card(db, db.get(User, student_id), preview_id)
                return vector
            engine.return_value.extract_embedding.side_effect = change_reference
            self.assertEqual(verify().json()['error']['code'], 'REFERENCE_CHANGED')
            engine.return_value.extract_embedding.side_effect = None
            self.assertFalse(client.get(f'/api/v1/identity/exams/{exam_id}/status', headers=headers).json()['data']['verified'])
            self.assertEqual(start().json()['error']['code'], 'IDENTITY_VERIFICATION_REQUIRED')
            self.assertTrue(verify().json()['data']['verified'])
            self.assertTrue(client.get(f'/api/v1/identity/exams/{exam_id}/status', headers=headers).json()['data']['verified'])
            self.assertEqual(start().status_code, 200)
            self.assertEqual(client.delete('/api/v1/identity', headers=headers).status_code, 200)
            self.assertEqual(verify().json()['error']['code'], 'REFERENCE_REQUIRED')
            with Session(self.engine) as db:
                self.assertIsNone(cards.active_reference(db, db.get(User, student_id)))
                self.assertEqual(db.get(User, student_id).student_card_status, 'NOT_SUBMITTED')
