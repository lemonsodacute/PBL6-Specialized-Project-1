from datetime import datetime, timedelta, timezone
from io import BytesIO
import os
from pathlib import Path
from unittest import TestCase, skipUnless
from unittest.mock import patch

import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.models.entities import StudentCardPreview, StudentCardReference, StudentFaceEmbedding
from app.services import student_card_identity as service, student_card_previews as previews
from app.services.student_card_matching import OCRLine
from app.services.student_card_ocr import OCRError
from app.services.face_recognition import FaceEngine, face_error
from tests.test_student_card_previews import PreviewStorageTests


class CardAPITests(TestCase):
    make_student = PreviewStorageTests.make_student
    headers = PreviewStorageTests.headers

    def setUp(self):
        PreviewStorageTests.setUp(self)
        StudentFaceEmbedding.__table__.create(self.engine)
        image = BytesIO()
        Image.new('RGB', (600, 400), 'white').save(image, format='PNG')
        self.content = image.getvalue()
        self.face = self.enterContext(patch.object(service, 'get_face_engine')).return_value
        self.face.prepare_card.return_value = (b'clean-card', b'clean-face')
        self.vector = np.zeros(128, dtype=np.float32)
        self.vector[0] = 1
        self.face.extract_embedding.return_value = self.vector
        self.ocr = self.enterContext(patch.object(service.ocr, 'recognize'))
        self.ocr.return_value = [OCRLine('Họ và tên: Nguyễn Văn Thiện', .99), OCRLine('MSSV: 001IT123', .99)]

    def upload(self, **kwargs):
        return self.client.post('/api/v1/identity/student-card/preview',
            headers=kwargs.pop('headers', self.headers()), files=kwargs.pop('files', {'image': ('card.png', self.content, 'image/png')}), **kwargs)

    def preview(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def confirm(self, preview, **extra):
        return self.client.post('/api/v1/identity/student-card/confirm', headers=self.headers(),
            json={'preview_id': preview['preview_id'], **extra})

    def test_upload_only_creates_private_preview_then_confirm_activates(self):
        data = self.preview()
        self.assertTrue(data['can_confirm'])
        self.assertNotIn('embedding', str(data))
        self.assertIsNone(self.db.scalar(select(StudentFaceEmbedding)))
        self.face.extract_embedding.assert_not_called()
        response = self.confirm(data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['data']['has_reference'])
        self.assertEqual(response.json()['data']['reference_status'], 'ACTIVE')
        self.assertFalse(response.json()['data']['update_requested'])
        stored = self.db.scalar(select(StudentFaceEmbedding))
        self.assertEqual(str(stored.reference_version), response.json()['data']['reference_version'])
        self.assertEqual(stored.embedding_dimension, 128)
        self.assertEqual(len(stored.embedding), 512)
        self.face.extract_embedding.assert_called_once_with(self.content, mode='card')
        row = self.db.scalar(select(StudentCardPreview))
        self.assertEqual(row.status, 'CONFIRMED')
        self.assertFalse(previews.private_path(row.original_image_key).exists())
        self.assertIn(self.confirm(data).status_code, (404, 409))

    @skipUnless(os.environ.get('STUDENT_CARD_TEST_IMAGE'), 'Opt-in private card image/model regression')
    def test_private_card_real_face_pipeline_through_preview_and_confirm_api(self):
        # Only OCR/profile data are synthetic. YuNet, alignCrop, SFace, quality
        # checks, HTTP routes and embedding persistence run their real code.
        self.content = Path(os.environ['STUDENT_CARD_TEST_IMAGE']).read_bytes()
        engine = FaceEngine()
        self.face.prepare_card.side_effect = engine.prepare_card
        self.face.extract_embedding.side_effect = engine.extract_embedding
        response = self.upload(files={'image': ('card.jpg', self.content, 'image/jpeg')})
        self.assertEqual(response.status_code, 200, response.text)
        response = self.confirm(response.json()['data'])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['data']['has_reference'])
        self.face.extract_embedding.assert_called_once_with(self.content, mode='card')
        stored = self.db.scalar(select(StudentFaceEmbedding))
        self.assertEqual(stored.embedding_dimension, 128)
        self.assertEqual(len(stored.embedding), 512)

    def test_auth_role_profile_and_unexpected_form_fields(self):
        for headers, status in (({}, 401), (self.headers(self.admin), 403)):
            self.assertEqual(self.upload(headers=headers).status_code, status)
        self.assertEqual(self.upload(data={'student_code': '001IT123'}).status_code, 422)
        self.user.identity_profile_status = 'PENDING'
        self.db.commit()
        result = self.upload()
        self.assertEqual(result.json()['error']['code'], 'PROFILE_NOT_VERIFIED')
        self.ocr.assert_not_called()

    def test_real_format_mime_size_and_face_errors(self):
        for content, mime, status in ((b'not-image', 'image/png', 422), (self.content, 'image/jpeg', 422),
                                      (self.content, 'image/webp', 422), (b'x' * (8 * 1024 * 1024 + 1), 'image/png', 413)):
            self.assertEqual(self.upload(files={'image': ('card', content, mime)}).status_code, status)
        for code in ('NO_FACE_DETECTED', 'MULTIPLE_FACES_DETECTED', 'FACE_TOO_SMALL', 'FACE_TOO_DARK', 'FACE_TOO_BLURRY'):
            self.face.prepare_card.side_effect = face_error(code, 'synthetic error')
            self.assertEqual(self.upload().json()['error']['code'], code)
        self.ocr.assert_not_called()

    def test_ocr_failure_and_model_error(self):
        for code, status in (('OCR_FAILED', 422), ('MODEL_ERROR', 503)):
            self.ocr.side_effect = OCRError(code)
            response = self.upload()
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.json()['error']['code'], code)

    def test_mismatch_missing_and_low_confidence_cannot_confirm(self):
        for lines in ([OCRLine('Họ tên: Nguyễn Văn Thiện', .99), OCRLine('MSSV: OO1IT123', .99)],
                      [OCRLine('MSSV: 001IT123', .99)],
                      [OCRLine('Họ tên: Nguyễn Văn Thiện', .5), OCRLine('MSSV: 001IT123', .99)]):
            self.ocr.return_value = lines
            data = self.preview()
            self.assertFalse(data['can_confirm'])
            self.assertEqual(self.confirm(data).status_code, 422)
        self.face.extract_embedding.assert_not_called()

    def test_ms_read_success_keeps_leading_zero_in_mismatched_preview(self):
        self.ocr.return_value = [OCRLine('Họ tên: Nguyễn Văn Thiện', .99), OCRLine('MS', .5),
                                OCRLine('06031034', .98), OCRLine('Ngành học: Kế toán doanh nghiệp', .97)]
        data = self.preview()
        self.assertEqual(data['extracted']['student_code'], '06031034')
        self.assertEqual(data['extracted']['major'], 'Kế toán doanh nghiệp')
        self.assertEqual(data['blocking_errors'], ['STUDENT_CODE_MISMATCH'])
        self.assertFalse(data['can_confirm'])
        row = self.db.scalar(select(StudentCardPreview))
        self.assertEqual(row.confidence_json['student_code'], .98)
        self.assertEqual(self.confirm(data).json()['error']['code'], 'STUDENT_CODE_MISMATCH')

    def test_class_metadata_has_confidence_and_status_without_blocking_confirm(self):
        identity = [OCRLine('Họ tên: Nguyễn Văn Thiện', .99), OCRLine('MSSV: 001IT123', .99)]
        self.ocr.return_value = identity + [OCRLine('Ngành: Công nghệ thông tin', .98), OCRLine('Lớp: 22T1', .94)]
        data = self.preview()
        self.assertEqual(data['extracted']['class_name'], '22T1')
        self.assertEqual(data['extracted']['class_confidence'], .94)
        self.assertEqual(data['extracted']['class_status'], 'READABLE')
        self.assertTrue(data['can_confirm'])
        self.ocr.return_value = identity + [OCRLine('Lớp: 22T1', .6)]
        data = self.preview()
        self.assertIsNone(data['extracted']['class_name'])
        self.assertEqual(data['extracted']['class_confidence'], .6)
        self.assertEqual(data['extracted']['class_status'], 'CLASS_UNREADABLE')
        self.assertTrue(data['can_confirm'])
        self.assertEqual(data['blocking_errors'], [])
        self.assertEqual(self.confirm(data).status_code, 200)

    def test_absent_class_is_metadata_and_does_not_produce_engine_failure(self):
        data = self.preview()
        self.assertIsNone(data['extracted']['class_name'])
        self.assertIsNone(data['extracted']['class_confidence'])
        self.assertEqual(data['extracted']['class_status'], 'CLASS_UNREADABLE')
        self.assertTrue(data['can_confirm'])
        self.assertNotIn('OCR_FAILED', data['blocking_errors'])

    def test_matching_normalization_never_substitutes_profile_into_display_name(self):
        import unicodedata
        from app.services.student_card_matching import normalize_name
        self.user.full_name = 'Đồng Thị Thùy Linh'
        self.user.student_code = '06031034'
        self.db.commit()
        self.ocr.return_value = [OCRLine('Họ tên: ' + unicodedata.normalize('NFD', 'ĐÔNG THỊ THUY LINH'), .95),
                                OCRLine('MS: 06031034', .98)]
        data = self.preview()
        self.assertEqual(data['extracted']['ocr_display_name'], 'ĐÔNG THỊ THUY LINH')
        self.assertEqual(data['extracted']['full_name'], 'ĐÔNG THỊ THUY LINH')
        self.assertEqual(normalize_name(data['extracted']['ocr_display_name']), 'dong thi thuy linh')
        self.assertTrue(data['comparison']['name_match'])
        self.assertEqual(data['comparison']['name_match_type'], 'NORMALIZED')
        self.assertTrue(data['can_confirm'])
        self.assertNotIn('normalized_name', data['extracted'])
        row = self.db.scalar(select(StudentCardPreview))
        self.assertEqual(row.extracted_json['ocr_display_name'], 'ĐÔNG THỊ THUY LINH')
        self.assertEqual(self.confirm(data).status_code, 200)
        self.db.refresh(self.user)
        self.assertEqual(self.user.full_name, 'Đồng Thị Thùy Linh')

    def test_unreadable_and_low_confidence_name_keep_independent_code_preview(self):
        for name_line, error, expected in (
            (None, 'NAME_UNREADABLE', None),
            (OCRLine('Full name: NGUYEN VAN THIEN', .8), 'NAME_LOW_CONFIDENCE', 'NGUYEN VAN THIEN'),
        ):
            self.ocr.return_value = ([name_line] if name_line else []) + [OCRLine('MSSV: 001IT123', .99)]
            data = self.preview()
            self.assertEqual(data['extracted']['full_name'], expected)
            self.assertEqual(data['extracted']['ocr_display_name'], expected)
            self.assertEqual(data['extracted']['student_code'], '001IT123')
            self.assertEqual(data['blocking_errors'], [error])
            self.assertEqual(self.confirm(data).json()['error']['code'], error)
        self.face.extract_embedding.assert_not_called()

    @skipUnless(os.environ.get('NAME_CARD_FIXTURE') and os.environ.get('NAME_CARD_EXPECTED_NAME')
                and os.environ.get('NAME_CARD_EXPECTED_CODE'), 'Explicit private name regression only')
    def test_private_name_card_through_real_ocr_face_preview_and_confirm(self):
        from app.services.student_card_ocr import LocalOCR
        self.user.full_name = os.environ['NAME_CARD_EXPECTED_NAME']
        self.user.student_code = os.environ['NAME_CARD_EXPECTED_CODE']
        self.db.commit()
        self.content = Path(os.environ['NAME_CARD_FIXTURE']).read_bytes()
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        self.ocr.side_effect = adapter.recognize
        engine = FaceEngine()
        self.face.prepare_card.side_effect = engine.prepare_card
        self.face.extract_embedding.side_effect = engine.extract_embedding
        response = self.upload(files={'image': ('card.jpg', self.content, 'image/jpeg')})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']
        self.assertTrue(data['extracted']['full_name'])
        self.assertEqual(data['extracted']['full_name'], data['extracted']['ocr_display_name'])
        self.assertEqual(data['extracted']['student_code'], os.environ['NAME_CARD_EXPECTED_CODE'])
        self.assertTrue(data['comparison']['name_match'])
        self.assertIn(data['comparison']['name_match_type'], ('EXACT', 'NORMALIZED'))
        self.assertTrue(data['can_confirm'], data)
        self.assertEqual(data['blocking_errors'], [])
        self.assertEqual(self.confirm(data).status_code, 200)
        self.assertEqual(self.user.full_name, os.environ['NAME_CARD_EXPECTED_NAME'])

    @skipUnless(os.environ.get('RUN_LOCAL_OCR_SMOKE') == '1' and os.environ.get('STUDENT_CARD_OCR_FIXTURE'),
                'Explicit production OCR model and real name fixture only')
    def test_real_vietnamese_name_preview_preserves_ocr_accents_and_existing_fields(self):
        from app.services.student_card_ocr import LocalOCR
        self.user.full_name = 'Đồng Thị Thùy Linh'
        self.user.student_code = '06031034'
        self.db.commit()
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        self.ocr.side_effect = adapter.recognize
        data = self.upload(files={'image': ('card.jpg', Path(os.environ['STUDENT_CARD_OCR_FIXTURE']).read_bytes(),
                                           'image/jpeg')}).json()['data']
        self.assertEqual(data['extracted']['ocr_display_name'], 'ĐÔNG THỊ THÙY LINH')
        self.assertEqual(data['extracted']['full_name'], 'ĐÔNG THỊ THÙY LINH')
        self.assertEqual(data['extracted']['student_code'], '06031034')
        self.assertEqual(data['extracted']['major'], 'Kế toán doanh nghiệp')
        self.assertTrue(data['comparison']['name_match'])
        self.assertTrue(data['can_confirm'])
        self.assertEqual(self.user.full_name, 'Đồng Thị Thùy Linh')

    def test_unreadable_code_is_parse_failure_without_mismatch_error(self):
        self.ocr.return_value = [OCRLine('Họ tên: Nguyễn Văn Thiện', .99), OCRLine('MS', .99),
                                OCRLine('Ngày sinh: 09/09/1990', .99)]
        data = self.preview()
        self.assertIsNone(data['extracted']['student_code'])
        self.assertEqual(data['blocking_errors'], ['STUDENT_CODE_UNREADABLE'])
        self.assertFalse(data['can_confirm'])
        self.assertEqual(self.confirm(data).json()['error']['code'], 'STUDENT_CODE_UNREADABLE')

    def test_bach_khoa_partial_result_returns_preview_and_blocks_only_missing_code(self):
        self.user.full_name = 'LE NGUYEN CHAU ANH'
        self.user.student_code = '102230057'
        self.db.commit()
        self.ocr.return_value = [OCRLine('Họ tên: LE NGUYEN CHAU ANH', .98),
                                OCRLine('Lớp: 23T_NHAT2', .97)]
        data = self.preview()
        self.assertEqual(data['extracted']['full_name'], 'LE NGUYEN CHAU ANH')
        self.assertEqual(data['extracted']['class_name'], '23T_NHAT2')
        self.assertIsNone(data['extracted']['student_code'])
        self.assertFalse(data['can_confirm'])
        self.assertEqual(data['blocking_errors'], ['STUDENT_CODE_UNREADABLE'])
        self.assertEqual(self.confirm(data).json()['error']['code'], 'STUDENT_CODE_UNREADABLE')
        self.face.extract_embedding.assert_not_called()

    @skipUnless(os.environ.get('RUN_LOCAL_OCR_SMOKE') == '1' and os.environ.get('BACH_KHOA_CARD_FIXTURE'),
                'Explicit production model and real Bach Khoa fixture only')
    def test_real_bach_khoa_preview_with_production_ocr_and_face_models(self):
        from app.services.face_recognition import FaceEngine
        from app.services.student_card_ocr import LocalOCR
        from app.services.student_card_matching import normalize_name
        self.user.full_name = 'LE NGUYEN CHAU ANH'
        self.user.student_code = '102230057'
        self.db.commit()
        self.content = Path(os.environ['BACH_KHOA_CARD_FIXTURE']).read_bytes()
        adapter = LocalOCR()
        self.addCleanup(adapter.close)
        adapter.start()
        self.ocr.side_effect = adapter.recognize
        with patch.object(service, 'get_face_engine', return_value=FaceEngine()):
            response = self.upload(files={'image': ('card.jpg', self.content, 'image/jpeg')})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']
        # Correct accented and accent-free OCR passes identify the same name.
        self.assertEqual(normalize_name(data['extracted']['full_name']), 'le nguyen chau anh')
        self.assertEqual(data['extracted']['student_code'], '102230057')
        self.assertEqual(data['extracted']['class_name'], '23T_NHAT2')
        self.assertTrue(data['can_confirm'])
        self.assertEqual(data['blocking_errors'], [])

    def test_unknown_confirm_fields_owner_expiry_supersession(self):
        data = self.preview()
        for key in ('student_id', 'student_code', 'full_name', 'embedding', 'image_path', 'extracted'):
            self.assertEqual(self.confirm(data, **{key: 'forged'}).status_code, 422)
        response = self.client.post('/api/v1/identity/student-card/confirm', headers=self.headers(self.other), json={'preview_id': data['preview_id']})
        self.assertEqual(response.status_code, 404)
        second = self.preview()
        self.assertEqual(self.confirm(data).json()['error']['code'], 'PREVIEW_SUPERSEDED')
        row = self.db.scalar(select(StudentCardPreview).where(StudentCardPreview.status == 'PENDING'))
        row.created_at = datetime.now(timezone.utc) - timedelta(minutes=20)
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        self.db.commit()
        self.assertEqual(self.confirm(second).json()['error']['code'], 'PREVIEW_EXPIRED')

    def test_hash_and_server_matching_rechecked(self):
        data = self.preview()
        row = self.db.scalar(select(StudentCardPreview))
        previews.private_path(row.original_image_key).write_bytes(b'changed')
        self.assertEqual(self.confirm(data).json()['error']['code'], 'INVALID_IMAGE')
        previews.private_path(row.original_image_key).write_bytes(self.content)
        row.extracted_json = {'full_name': self.user.full_name, 'student_code': 'FORGED'}
        row.validation_json = {'can_confirm': True}
        self.db.commit()
        self.assertEqual(self.confirm(data).json()['error']['code'], 'STUDENT_CODE_MISMATCH')

    def test_profile_changed_during_inference_rejected(self):
        data = self.preview()
        def inference(_, *, mode):
            self.assertEqual(mode, 'card')
            self.user.identity_profile_version += 1
            self.db.commit()
            return self.vector
        self.face.extract_embedding.side_effect = inference
        self.assertEqual(self.confirm(data).json()['error']['code'], 'PROFILE_CHANGED')
        self.assertIsNone(self.db.scalar(select(StudentFaceEmbedding)))

    def test_rollback_preserves_old_reference_embedding_and_new_preview(self):
        first = self.confirm(self.preview()).json()['data']['reference_version']
        second = self.preview()
        with patch.object(self.db, 'commit', side_effect=SQLAlchemyError('private driver details')):
            response = self.confirm(second)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private driver', response.text)
        self.assertEqual(str(service.active_reference(self.db, self.user).id), first)
        self.assertEqual(str(self.db.scalar(select(StudentFaceEmbedding)).reference_version), first)
        self.assertEqual(self.confirm(second).status_code, 200)
        refs = list(self.db.scalars(select(StudentCardReference)))
        self.assertEqual(sorted(r.status for r in refs), ['ACTIVE', 'SUPERSEDED'])
        self.assertIsNone(next(r for r in refs if r.status == 'SUPERSEDED').sanitized_face)

    def test_admin_change_invalidates_reference_even_after_reverification(self):
        from app.services.student_identity_profile import update_profile, verify_profile
        self.confirm(self.preview())
        reference = service.active_reference(self.db, self.user)
        update_profile(self.db, self.user, {'full_name': 'Nguyễn Văn An'})
        self.db.commit()
        self.assertEqual(reference.status, 'INVALIDATED')
        self.assertIsNone(reference.sanitized_face)
        verify_profile(self.user, self.admin, self.user.identity_profile_version)
        self.db.commit()
        self.assertIsNone(service.active_reference(self.db, self.user))

    def test_failed_face_recheck_preserves_previous_reference(self):
        first = self.confirm(self.preview()).json()['data']['reference_version']
        data = self.preview()
        self.face.extract_embedding.side_effect = face_error('MULTIPLE_FACES_DETECTED', 'synthetic')
        self.assertEqual(self.confirm(data).status_code, 422)
        self.assertEqual(str(service.active_reference(self.db, self.user).id), first)

    def test_generic_embedding_writer_cannot_keep_old_trust_binding(self):
        from app.services.face_embeddings import save_face_embedding
        self.confirm(self.preview())
        save_face_embedding(self.db, self.user.id, self.vector)
        self.db.commit()
        self.assertIsNone(service.active_reference(self.db, self.user))
