import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO
from itertools import permutations
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.datastructures import Headers, UploadFile

from app.api.v1 import identity as routes
from app.api.deps import get_current_user
from app.api.v1.attempts import start
from app.main import app
from app.models.entities import AttemptStatus, UserRole
from app.schemas.attempts import AttemptStart
from app.services.face_recognition import FaceEngine, MAX_IMAGE_BYTES, face_error, compare_embeddings


def upload(content=b'photo', content_type='image/jpeg'):
    return UploadFile(filename='photo.jpg', file=BytesIO(content), headers=Headers({'content-type': content_type}))


class IdentityTests(TestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=uuid4(), role=UserRole.student, is_active=True, identity_profile_status='VERIFIED',
            identity_profile_version=1, student_card_status='VERIFIED', student_code='001IT123', full_name='Synthetic Student')
        self.now = datetime.now(timezone.utc)
        self.reference = SimpleNamespace(id=uuid4(), status='ACTIVE', created_at=self.now - timedelta(hours=1))
        self.identity = SimpleNamespace(
            student_id=self.user.id, front_image_path='/private/identity/front.jpg',
            left_image_path='/private/identity/left.jpg', right_image_path='/private/identity/right.jpg',
            updated_at=self.now - timedelta(hours=1), status='verified',
        )

    def test_upload_size_and_mime_are_checked(self):
        for content, mime, code in ((b'bad', 'text/plain', 'INVALID_IMAGE_TYPE'), (b'x' * (MAX_IMAGE_BYTES + 1), 'image/jpeg', 'IMAGE_TOO_LARGE')):
            with self.subTest(code=code), self.assertRaises(HTTPException) as raised:
                asyncio.run(routes._read_image(upload(content, mime)))
            self.assertEqual(raised.exception.detail['code'], code)

    def test_consent_required_before_any_work(self):
        db = MagicMock()
        for endpoint, arguments in ((routes._legacy_enroll, {'front': upload(), 'left': upload(), 'right': upload()}), (routes._legacy_check, {'image': upload()}), (routes.verify, {'exam_id': uuid4(), 'image': upload()})):
            with self.subTest(endpoint=endpoint.__name__), self.assertRaises(HTTPException) as raised:
                asyncio.run(endpoint(**arguments, consent=False, db=db, user=self.user))
            self.assertEqual(raised.exception.detail['code'], 'CONSENT_REQUIRED')
        db.scalar.assert_not_called()

    def test_latest_verification_expiry_and_reenrollment(self):
        verification = SimpleNamespace(status='verified', reference_version=self.reference.id, created_at=self.now - timedelta(minutes=1))
        self.assertTrue(routes.verification_is_current(verification, self.reference, self.now))
        for status, created, identity in (
            ('pending_model', self.now, self.reference), ('rejected', self.now, self.reference),
            ('verified', self.now - timedelta(minutes=16), self.reference),
            ('verified', self.now - timedelta(hours=2), self.reference),
            ('verified', self.now + timedelta(minutes=1), self.reference), ('verified', self.now, None),
        ):
            with self.subTest(status=status, created=created):
                self.assertFalse(routes.verification_is_current(SimpleNamespace(status=status, reference_version=self.reference.id, created_at=created), identity, self.now))
        for version in (None, uuid4()):
            verification.reference_version = version
            self.assertFalse(routes.verification_is_current(verification, self.reference, self.now))

    def test_private_storage_rejects_traversal(self):
        for value in ('/private/identity/../secret', '/uploads/identity/../../secret', '/private/identity/..\\secret', '/uploads/elsewhere.jpg', '/private/identity/'):
            self.assertIsNone(routes._image_path(value))

    def test_public_mount_blocks_legacy_photos(self):
        with TestClient(app, raise_server_exceptions=False) as client:
            self.assertEqual(client.get('/uploads/identity/any.jpg').status_code, 404)
            self.assertEqual(client.get('/private/identity/any.jpg').status_code, 404)
            self.assertEqual(client.post('/api/v1/identity/check').status_code, 401)

    def test_delete_commits_verifications_even_without_enrollment(self):
        db = MagicMock()
        db.scalar.return_value = None
        verification = SimpleNamespace(image_path='/private/identity/old.jpg')
        db.scalars.return_value.all.return_value = [verification]
        with patch.object(routes, '_remove_image') as remove, patch.object(routes, 'lock_user', return_value=self.user):
            routes.delete(db, self.user)
        db.delete.assert_called_once_with(verification)
        db.commit.assert_called_once()
        remove.assert_called_once_with(verification.image_path)

    def test_enrollment_database_failure_preserves_old_files(self):
        db = MagicMock()
        db.scalar.side_effect = [self.user, self.identity]
        db.commit.side_effect = RuntimeError('database unavailable')
        engine = MagicMock()
        engine.extract.return_value = ('feature', b'clean image')
        engine.compare_embeddings.return_value = 0.9
        with TemporaryDirectory() as directory, patch.object(routes, 'IDENTITY_DIR', Path(directory)), patch.object(routes, 'get_face_engine', return_value=engine):
            original = Path(directory) / 'front.jpg'
            original.write_bytes(b'old photo')
            with self.assertRaises(RuntimeError):
                asyncio.run(routes._legacy_enroll(upload(), upload(), upload(), True, db, self.user))
            self.assertEqual([p.name for p in Path(directory).iterdir()], ['front.jpg'])
            self.assertEqual(original.read_bytes(), b'old photo')
        db.rollback.assert_called_once()

    def test_mismatched_enrollment_never_writes(self):
        db = MagicMock()
        engine = MagicMock()
        engine.extract.return_value = ('feature', b'clean image')
        engine.compare_embeddings.return_value = 0.1
        with patch.object(routes, 'get_face_engine', return_value=engine), patch.object(routes, '_save_image') as save:
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(routes._legacy_enroll(upload(), upload(), upload(), True, db, self.user))
        self.assertEqual(raised.exception.detail['code'], 'ENROLLMENT_FACE_MISMATCH')
        save.assert_not_called()
        db.commit.assert_not_called()

    def test_trial_does_not_persist_or_authorize_exam(self):
        db = MagicMock()
        db.scalar.return_value = self.identity
        with patch.object(routes, '_compare', return_value=({'verified': True}, b'clean')):
            result = asyncio.run(routes._legacy_check(upload(), True, db, self.user))
        self.assertTrue(result['data']['verified'])
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_compare_keeps_median_of_three_and_uses_embedding_only_for_references(self):
        import numpy as np

        feature = np.eye(1, 128, dtype=np.float32)[0]
        cases = [(scores, expected) for base, expected in (((.95, .1, .2), False), ((.8, .7, .1), True))
                 for scores in permutations(base)]
        for scores, expected in cases:
            with self.subTest(scores=scores), TemporaryDirectory() as directory:
                paths = [Path(directory) / f'{index}.jpg' for index in range(3)]
                for path in paths:
                    path.write_bytes(b'reference image')
                references = []
                for score in scores:
                    reference = np.zeros(128, dtype=np.float32)
                    reference[:2] = [score, np.sqrt(1 - score * score)]
                    references.append(reference)
                engine = MagicMock()
                engine.extract.return_value = (feature, b'clean image')
                engine.extract_embedding.side_effect = references
                engine.compare_embeddings.side_effect = compare_embeddings
                with patch.object(routes, 'get_face_engine', return_value=engine), \
                        patch.object(routes, '_image_path', side_effect=paths), \
                        patch.object(routes, 'match_threshold', return_value=.363):
                    result, image = routes._compare(self.identity, b'probe')
                self.assertEqual(result['verified'], expected)
                self.assertAlmostEqual(result['score'], sorted(scores)[1], places=4)
                self.assertEqual(result['threshold'], .363)
                self.assertEqual(image, b'clean image')
                engine.extract.assert_called_once_with(b'probe')
                self.assertEqual(engine.extract_embedding.call_count, 3)

    def test_median_ties_threshold_equality_and_rounding(self):
        engine = MagicMock()
        engine.extract.return_value = ('probe', b'clean')
        for scores, expected in (((.5, .5, .1), True), ((.9, .49999, .49999), False)):
            engine.compare_embeddings.side_effect = scores
            with self.subTest(scores=scores), patch.object(routes, 'get_face_engine', return_value=engine), \
                    patch.object(routes, '_image_path', return_value=MagicMock()), \
                    patch.object(routes, 'match_threshold', return_value=.5):
                result, _ = routes._compare(self.identity, b'probe')
            self.assertEqual(result['score'], .5)
            self.assertEqual(result['verified'], expected)
            self.assertEqual(result['threshold'], .5)

    def test_face_errors_keep_http_status_and_programming_errors_remain_internal(self):
        db, engine = MagicMock(), MagicMock()
        db.scalar.return_value = self.identity
        codes = ('NO_FACE_DETECTED', 'MULTIPLE_FACES_DETECTED', 'FACE_TOO_SMALL', 'INVALID_IMAGE', 'MODEL_ERROR')
        errors = [(face_error(code, 'Face error', 503 if code == 'MODEL_ERROR' else 422), code) for code in codes]
        errors.append((RuntimeError('Programming error'), 'INTERNAL_ERROR'))
        with patch.dict(app.dependency_overrides, {routes.get_db: lambda: db, get_current_user: lambda: self.user}), \
                patch.object(routes, 'get_face_engine', return_value=engine), \
                patch.object(routes, '_require_exam'), patch.object(routes, 'lock_user', return_value=self.user), \
                patch.object(routes, 'require_reference', return_value=self.reference), patch.object(routes, 'get_face_embedding'), \
                TestClient(app, raise_server_exceptions=False) as client:
            for error, code in errors:
                with self.subTest(code=code):
                    engine.extract_embedding.side_effect = error
                    response = client.post(f'/api/v1/identity/exams/{uuid4()}/verify', data={'consent': 'true'},
                                           files={'image': ('probe.jpg', b'photo', 'image/jpeg')})
                    self.assertEqual(response.status_code, getattr(error, 'status_code', 500))
                    self.assertEqual(response.json()['error']['code'], code)
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_legacy_endpoints_remain_but_cannot_enroll_or_check(self):
        with patch.dict(app.dependency_overrides, {get_current_user: lambda: self.user}), \
                patch.object(routes, 'get_face_engine') as engine, TestClient(app) as client:
            for route in ('enroll', 'check'):
                response = client.post('/api/v1/identity/' + route)
                self.assertEqual(response.status_code, 410)
                self.assertEqual(response.json()['error']['code'], 'LEGACY_IDENTITY_DEPRECATED')
                self.assertTrue(app.openapi()['paths']['/api/v1/identity/' + route]['post']['deprecated'])
            engine.assert_not_called()

    def test_enrollment_keeps_face_error_label(self):
        engine = MagicMock()
        engine.extract.side_effect = face_error('NO_FACE_DETECTED', 'No face')
        with patch.object(routes, 'get_face_engine', return_value=engine), self.assertRaises(HTTPException) as raised:
            asyncio.run(routes._legacy_enroll(upload(), upload(), upload(), True, MagicMock(), self.user))
        self.assertEqual(raised.exception.detail['code'], 'NO_FACE_DETECTED')
        self.assertEqual(raised.exception.detail['message'], 'Nhìn thẳng: No face')

    def test_unassigned_exam_cannot_verify(self):
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id=uuid4(), deleted_at=None)
        db.scalar.return_value = None
        with patch.object(routes, '_compare') as compare, self.assertRaises(HTTPException) as raised:
            asyncio.run(routes.verify(uuid4(), upload(), True, db, self.user))
        self.assertEqual(raised.exception.status_code, 404)
        compare.assert_not_called()

    def test_verification_never_succeeds_when_model_is_unavailable(self):
        db = MagicMock()
        db.scalar.side_effect = [uuid4(), self.identity]
        db.get.return_value = SimpleNamespace(id=uuid4(), deleted_at=None)
        with patch.object(routes, 'get_face_engine', side_effect=face_error('MODEL_ERROR', 'Unavailable', 503)), \
                patch.object(routes, 'lock_user', return_value=self.user), patch.object(routes, 'require_reference', return_value=self.reference), \
                patch.object(routes, 'get_face_embedding'), self.assertRaises(HTTPException) as raised:
            asyncio.run(routes.verify(uuid4(), upload(), True, db, self.user))
        self.assertEqual(raised.exception.status_code, 503)
        db.add.assert_not_called()

    def test_camera_exam_requires_server_verification(self):
        db = MagicMock()
        exam = SimpleNamespace(id=uuid4(), deleted_at=None, start_time=self.now - timedelta(hours=1), end_time=self.now + timedelta(hours=1), require_camera=True, max_attempts=2)
        db.scalar.side_effect = [exam, uuid4(), None, self.user]
        with patch('app.services.exam_entry.require_reference', return_value=self.reference), self.assertRaises(HTTPException) as raised:
            start(AttemptStart(exam_id=exam.id), db, self.user)
        self.assertEqual(raised.exception.detail['code'], 'FINAL_IDENTITY_VERIFICATION_REQUIRED')
        db.add.assert_not_called()

    def test_existing_attempt_requires_a_final_recheck_too(self):
        db = MagicMock()
        exam = SimpleNamespace(id=uuid4(), deleted_at=None, start_time=self.now - timedelta(hours=1), end_time=self.now + timedelta(hours=1), require_camera=True)
        attempt = SimpleNamespace(id=uuid4(), status=AttemptStatus.in_progress)
        db.scalar.side_effect = [exam, uuid4(), None, self.user]
        with patch('app.services.exam_entry.require_reference', return_value=self.reference), self.assertRaises(HTTPException) as raised:
            start(AttemptStart(exam_id=exam.id), db, self.user)
        self.assertEqual(raised.exception.status_code, 403)
        db.add.assert_not_called()


class FaceImageTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = FaceEngine()

    def test_empty_corrupt_and_non_image_data(self):
        for content, code in ((b'', 'INVALID_IMAGE'), (b'fake-jpeg', 'INVALID_IMAGE')):
            with self.subTest(code=code), self.assertRaises(HTTPException) as raised:
                self.engine.extract(content)
            self.assertEqual(raised.exception.detail['code'], code)

    def test_valid_image_without_face_is_rejected(self):
        output = BytesIO()
        self.engine.Image.new('RGB', (640, 480), 'white').save(output, format='JPEG')
        with self.assertRaises(HTTPException) as raised:
            self.engine.extract(output.getvalue())
        self.assertEqual(raised.exception.detail['code'], 'NO_FACE_DETECTED')

    def test_more_than_one_face_is_rejected(self):
        output = BytesIO()
        self.engine.Image.new('RGB', (640, 480), 'white').save(output, format='PNG')
        detector = MagicMock()
        detector.detect.return_value = (None, self.engine.np.zeros((2, 15)))
        with patch.object(self.engine, 'detector', detector), self.assertRaises(HTTPException) as raised:
            self.engine.extract(output.getvalue())
        self.assertEqual(raised.exception.detail['code'], 'MULTIPLE_FACES_DETECTED')


if __name__ == '__main__':
    main()
