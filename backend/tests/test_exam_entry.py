"""HTTP/DB gate tests. Synthetic embeddings exercise authorization, not biometric accuracy."""
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import os
import re
from unittest import TestCase, skipUnless
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.api.v1 import attempts, identity
from app.core.config import settings
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import Exam, ExamAssignment, ExamAttempt, IdentityVerification, StudentCardReference, StudentFaceEmbedding, User, UserRole
from app.services import exam_entry
from app.services.face_recognition import face_error


@compiles(JSONB, 'sqlite')
@compiles(INET, 'sqlite')
def compile_types(_type, _compiler, **_kwargs):
    return 'TEXT'


@asynccontextmanager
async def isolated_lifespan(_app):
    yield  # Never start application workers against the configured real database.


class ExamEntryTests(TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        self.addCleanup(self.engine.dispose)
        @event.listens_for(self.engine, 'connect')
        def configure(connection, _):
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)
            connection.create_function('num_nonnulls', -1, lambda *items: sum(item is not None for item in items))
        Base.metadata.create_all(self.engine)
        self.db = self.enterContext(Session(self.engine, expire_on_commit=False))
        self.now = datetime.now(timezone.utc)
        self.user = User(id=uuid4(), email=f'{uuid4()}@example.com', full_name='Synthetic Student', password_hash='unused', role=UserRole.student,
            is_active=True, student_code='001TEST', identity_profile_status='VERIFIED', identity_profile_version=1,
            identity_verified_at=self.now, student_card_status='VERIFIED')
        self.db.add(self.user); self.db.flush()
        self.reference = StudentCardReference(id=uuid4(), student_id=self.user.id, identity_profile_version=1, status='ACTIVE', created_at=self.now-timedelta(hours=1))
        self.db.add(self.reference); self.db.flush()
        self.db.add(StudentFaceEmbedding(student_id=self.user.id, reference_version=self.reference.id, embedding=b'\0' * 512,
            model_name='sface', model_version='2021dec', preprocessing_version='yunet-sface-v1', embedding_dimension=128))
        self.exam = Exam(id=uuid4(), created_by=self.user.id, title='Entry gate test', start_time=self.now-timedelta(hours=1),
            end_time=self.now+timedelta(hours=1), duration_minutes=30, max_attempts=3, require_camera=True, require_mic=True)
        self.db.add(self.exam); self.db.flush()
        self.db.add(ExamAssignment(exam_id=self.exam.id, student_id=self.user.id)); self.db.commit()
        self.actor = self.user
        self.enterContext(patch.dict(app.dependency_overrides, {get_db: lambda: self.db, get_current_user: lambda: self.actor}))
        self.enterContext(patch.object(identity, 'get_face_embedding', return_value='reference-A'))
        self.face = MagicMock()
        self.face.extract_embedding.side_effect = lambda content: content
        self.face.compare_embeddings.side_effect = lambda probe, template: .9 if probe.startswith(b'A') else .1
        self.enterContext(patch.object(identity, 'get_face_engine', return_value=self.face))
        self.enterContext(patch.object(attempts, '_serialize_attempt', side_effect=lambda db, row, user: {'id': str(row.id), 'status': row.status.value}))
        self.enterContext(patch.object(app.router, 'lifespan_context', isolated_lifespan))
        self.client = self.enterContext(TestClient(app))

    def verify(self, frame=b'A-final', *, final=True):
        return self.client.post(f'/api/v1/identity/exams/{self.exam.id}/' + ('verify-entry' if final else 'verify'),
            data={'consent': 'true'}, files={'image': ('live.jpg', frame, 'image/jpeg')})

    def start(self, verification_id=None, **extra):
        payload = {'exam_id': str(self.exam.id), **extra}
        if verification_id: payload['entry_verification_id'] = str(verification_id)
        return self.client.post('/api/v1/attempts', json=payload)

    def count_attempts(self):
        return self.db.scalar(select(func.count()).select_from(ExamAttempt))

    def test_old_generic_success_and_direct_api_are_blocked(self):
        proof = self.verify(b'A-initial', final=False).json()['data']
        for identifier in (None, proof['id'], uuid4()):
            response = self.start(identifier)
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual(self.count_attempts(), 0)
        alias = self.client.post('/api/v1/attempts/start', json={'exam_id': str(self.exam.id)})
        self.assertEqual(alias.status_code, 403)

    def test_student_a_then_student_b_cannot_start_or_start_timer(self):
        self.assertTrue(self.verify(b'A-initial', final=False).json()['data']['verified'])
        swapped = self.verify(b'B-live')
        self.assertEqual(swapped.status_code, 200, swapped.text)
        self.assertFalse(swapped.json()['data']['verified'])
        self.assertEqual(swapped.json()['data']['message'], exam_entry.ENTRY_MISMATCH)
        self.assertEqual(self.start(swapped.json()['data']['id']).status_code, 403)
        self.assertEqual(self.count_attempts(), 0)

    def test_current_student_starts_once_and_proof_is_consumed(self):
        self.verify(b'A-initial', final=False)
        proof = self.verify().json()['data']
        self.assertEqual(proof['threshold'], .363)
        response = self.start(proof['id'])
        self.assertEqual(response.status_code, 200, response.text)
        row = self.db.scalar(select(ExamAttempt))
        self.assertIsNotNone(row.started_at)
        self.assertEqual((row.server_deadline_at-row.started_at).total_seconds(), 1800)
        stored = self.db.get(IdentityVerification, UUID(proof['id']))
        self.assertTrue(stored.liveness_json['consumed_at'])
        self.assertEqual(self.start(proof['id']).status_code, 403)
        self.assertEqual(self.count_attempts(), 1)

    def test_expired_future_wrong_owner_exam_version_profile_and_consumed_proofs_fail(self):
        for mutation in ('expired', 'future', 'owner', 'exam', 'reference', 'profile', 'consumed'):
            with self.subTest(mutation=mutation):
                proof = self.verify(f'A-{mutation}'.encode()).json()['data']
                row = self.db.get(IdentityVerification, UUID(proof['id']))
                meta = dict(row.liveness_json)
                if mutation == 'expired': meta['frame_received_at'] = (self.now-timedelta(seconds=21)).isoformat()
                if mutation == 'future': row.created_at = self.now+timedelta(minutes=1)
                if mutation == 'owner': row.student_id = uuid4()
                if mutation == 'exam': row.exam_id = uuid4()
                if mutation == 'reference': row.reference_version = uuid4()
                if mutation == 'profile': meta['profile_version'] = 99
                if mutation == 'consumed': meta['consumed_at'] = self.now.isoformat()
                row.liveness_json = meta
                self.db.commit()
                self.assertEqual(self.start(proof['id']).status_code, 403)
                self.assertEqual(self.count_attempts(), 0)

    def test_reference_changes_during_inference_never_issue_a_proof(self):
        def changed(_):
            self.reference.status = 'SUPERSEDED'
            self.db.commit()
            return b'A-live'
        self.face.extract_embedding.side_effect = changed
        response = self.verify()
        self.assertIn(response.status_code, (409, 422))
        self.assertEqual(self.db.scalar(select(func.count()).select_from(IdentityVerification)), 0)
        self.assertEqual(self.count_attempts(), 0)

    def test_no_face_and_multiple_faces_block_with_exact_safe_messages(self):
        for code in ('NO_FACE_DETECTED', 'MULTIPLE_FACES_DETECTED'):
            with self.subTest(code=code):
                self.face.extract_embedding.side_effect = face_error(code, 'Internal detector details')
                response = self.verify()
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()['error']['message'], exam_entry.ENTRY_FACE_ERRORS[code])
                self.assertEqual(self.start().status_code, 403)
                self.assertEqual(self.count_attempts(), 0)

    def test_reusing_initial_or_previous_frame_is_rejected(self):
        self.verify(b'A-initial', final=False)
        self.assertEqual(self.verify(b'A-initial').json()['error']['code'], 'FRESH_FRAME_REQUIRED')
        self.assertEqual(self.count_attempts(), 0)

    def test_model_failure_and_changed_reference_fail_closed(self):
        self.face.extract_embedding.side_effect = face_error('MODEL_ERROR', 'Unavailable', 503)
        self.assertEqual(self.verify().status_code, 503)
        self.assertEqual(self.start().status_code, 403)
        self.assertEqual(self.count_attempts(), 0)

    def test_resume_requires_fresh_proof_and_keeps_original_deadline(self):
        proof = self.verify().json()['data']['id']
        attempt_id = self.start(proof).json()['data']['id']
        row = self.db.get(ExamAttempt, UUID(attempt_id))
        deadline = row.server_deadline_at
        self.assertEqual(self.start().status_code, 403)
        proof = self.verify(b'A-resume').json()['data']['id']
        resumed = self.start(proof, resume_attempt_id=attempt_id)
        self.assertEqual(resumed.status_code, 200, resumed.text)
        self.assertEqual(resumed.json()['data']['id'], attempt_id)
        self.assertEqual(row.server_deadline_at, deadline)
        self.assertEqual(self.count_attempts(), 1)

    def test_latest_failed_recheck_invalidates_an_earlier_unused_proof(self):
        proof = self.verify().json()['data']['id']
        self.verify(b'B-swap')
        self.assertEqual(self.start(proof).status_code, 403)

    def test_expired_previous_attempt_is_finalized_before_consuming_new_entry_proof(self):
        proof = self.verify().json()['data']['id']
        first_id = UUID(self.start(proof).json()['data']['id'])
        first = self.db.get(ExamAttempt, first_id)
        first.server_deadline_at = self.now - timedelta(seconds=1)
        self.db.commit()
        proof = self.verify(b'A-next-attempt').json()['data']['id']
        response = self.start(proof)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotEqual(response.json()['data']['id'], str(first_id))
        self.assertEqual(first.status.value, 'auto_submitted')
        self.assertEqual(self.count_attempts(), 2)
        self.assertTrue(self.db.get(IdentityVerification, UUID(proof)).liveness_json['consumed_at'])

    def test_exam_without_camera_keeps_existing_entry_behavior(self):
        self.exam.require_camera = False
        self.db.commit()
        self.assertEqual(self.start().status_code, 200)

    def test_non_student_cannot_verify_or_start(self):
        self.actor = User(id=uuid4(), role=UserRole.teacher, is_active=True)
        self.assertEqual(self.verify().status_code, 403)
        self.assertEqual(self.start().status_code, 403)


@skipUnless(os.environ.get('EXAM_ENTRY_TEST_POSTGRES') == '1', 'Requires isolated PostgreSQL test database')
class EntryConcurrencyTests(TestCase):
    def test_one_proof_cannot_be_consumed_by_concurrent_transactions(self):
        control = create_engine(settings.DATABASE_URL, isolation_level='AUTOCOMMIT', hide_parameters=True)
        name = f'proctoowl_entry_test_{uuid4().hex}'
        engine = None
        try:
            with control.connect() as connection:
                connection.execute(text(f'CREATE DATABASE "{name}"'))
            engine = create_engine(control.url.set(database=name), hide_parameters=True)
            Base.metadata.create_all(engine)
            with Session(engine, expire_on_commit=False) as db:
                now = datetime.now(timezone.utc)
                user = User(id=uuid4(), full_name='Test', email=f'{uuid4()}@example.com', password_hash='unused', role=UserRole.student,
                    student_code='TEST', is_active=True, identity_profile_status='VERIFIED', identity_profile_version=1,
                    identity_verified_at=now, student_card_status='VERIFIED')
                db.add(user); db.flush()
                ref = StudentCardReference(id=uuid4(), student_id=user.id, identity_profile_version=1, status='ACTIVE', created_at=now-timedelta(hours=1))
                db.add(ref); db.flush()
                db.add(StudentFaceEmbedding(student_id=user.id, reference_version=ref.id, embedding=b'\0' * 512, model_name='sface', model_version='2021dec', preprocessing_version='yunet-sface-v1', embedding_dimension=128))
                exam = Exam(id=uuid4(), title='Test', created_by=user.id, start_time=now, end_time=now+timedelta(hours=1), duration_minutes=30)
                db.add(exam); db.flush()
                verification = IdentityVerification(id=uuid4(), student_id=user.id, exam_id=exam.id, reference_version=ref.id, status='verified', created_at=now,
                    liveness_json={'purpose': exam_entry.ENTRY_PURPOSE, 'frame_received_at': now.isoformat(), 'profile_version': 1})
                db.add(verification); db.commit()
                user_id, exam_id, proof_id = user.id, exam.id, verification.id
            def consume(_):
                from fastapi import HTTPException
                with Session(engine) as db:
                    try:
                        db.scalar(select(Exam).where(Exam.id == exam_id).with_for_update())
                        exam_entry.consume_entry_verification(db, db.get(User, user_id), exam_id, proof_id)
                        db.commit()
                        return 'accepted'
                    except HTTPException as error:
                        db.rollback()
                        return error.status_code
            with ThreadPoolExecutor(max_workers=2) as executor:
                outcomes = list(executor.map(consume, range(2)))
            self.assertCountEqual(outcomes, ['accepted', 403])
        finally:
            if engine: engine.dispose()
            if not re.fullmatch(r'proctoowl_entry_test_[0-9a-f]{32}', name): raise RuntimeError('Unexpected test database')
            with control.connect() as connection:
                connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            control.dispose()
