from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.entities import AuditLog, Class, ClassEnrollment, StudentCardPreview, StudentCardReference, StudentFaceEmbedding, User
from app.services import student_card_identity as service, student_card_previews as previews
from app.services.student_card_matching import OCRLine
from app.services.student_card_ocr import OCRError
from tests import test_student_card_api as fixtures


class CardProfileFlowTests(TestCase):
    setUp = fixtures.CardAPITests.setUp
    make_student = fixtures.CardAPITests.make_student
    headers = fixtures.CardAPITests.headers
    upload = fixtures.CardAPITests.upload
    preview = fixtures.CardAPITests.preview
    confirm = fixtures.CardAPITests.confirm

    def card(self, code='001IT123', class_name='22T1', class_confidence=.97):
        self.ocr.return_value = [OCRLine('Họ tên: Nguyễn Văn Thiện', .99), OCRLine('MSSV: '+code, .99),
                                 OCRLine('Ngành: Công nghệ thông tin', .98)]
        if class_name is not None:
            self.ocr.return_value.append(OCRLine('Lớp: '+class_name, class_confidence))

    def profile(self):
        # Read persisted state; SQLite also drops timezone information on reload.
        self.db.expire_all()
        response = self.client.get('/api/v1/auth/me', headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['user']

    def test_missing_code_and_class_persist_only_after_confirm_and_survive_new_session(self):
        self.user.student_code = None
        self.db.commit()
        self.card('102230057')
        before = self.profile()
        data = self.preview()
        self.assertTrue(data['can_confirm'])
        self.assertTrue(data['comparison']['student_code_will_update'])
        self.assertEqual(data['extracted']['class_name'], '22T1')
        self.assertEqual(self.profile(), before)
        response = self.confirm(data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.ocr.call_count, 2)  # Global/ROI worker is run again at confirmation.
        profile = self.profile()
        self.assertEqual(profile['student_code'], '102230057')
        self.assertEqual(profile['class_name'], '22T1')
        self.assertEqual(profile['student_card_status'], 'VERIFIED')
        self.assertEqual(profile['identity_profile_version'], before['identity_profile_version']+1)
        self.assertEqual(profile['avatar_source'], 'STUDENT_CARD')
        with Session(self.engine) as fresh:
            stored = fresh.get(User, self.user.id)
            self.assertEqual((stored.student_code, stored.class_name), ('102230057', '22T1'))
            reference = service.active_reference(fresh, stored)
            self.assertIsNotNone(reference)
            self.assertEqual(reference.identity_profile_version, stored.identity_profile_version)
        event = self.db.scalar(select(AuditLog).where(AuditLog.action == 'PROFILE_UPDATED_FROM_STUDENT_CARD'))
        self.assertEqual(event.metadata_json['fields_changed'], ['student_code', 'class_name'])
        self.assertNotIn('102230057', str(event.metadata_json))
        self.assertNotIn('22T1', str(event.metadata_json))
        self.assertIsNotNone(self.db.scalar(select(AuditLog).where(AuditLog.action == 'STUDENT_CARD_CONFIRMED')))

    def test_preview_replacement_and_ttl_do_not_mutate_profile_or_enroll_student(self):
        Class.__table__.create(self.engine); ClassEnrollment.__table__.create(self.engine)
        self.user.student_code = None
        self.user.class_name = '20T1'
        self.db.commit()
        before = self.profile()
        self.card('102230057', '22T1'); first = self.preview()
        self.card('102230057', '22T2'); second = self.preview()
        self.assertEqual(self.profile(), before)
        self.assertEqual(self.confirm(first).json()['error']['code'], 'PREVIEW_SUPERSEDED')
        row = self.db.scalar(select(StudentCardPreview).where(StudentCardPreview.status == 'PENDING'))
        row.created_at = datetime.now(timezone.utc)-timedelta(minutes=20)
        row.expires_at = datetime.now(timezone.utc)-timedelta(minutes=10)
        self.db.commit()
        self.assertEqual(self.confirm(second).json()['error']['code'], 'PREVIEW_EXPIRED')
        previews.cleanup_previews(self.db)
        self.assertEqual(self.profile(), before)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ClassEnrollment)), 0)

    def test_existing_code_cannot_be_overwritten_in_preview_or_during_recheck(self):
        self.user.class_name = '20T1'; self.db.commit()
        self.card('999999999')
        data = self.preview()
        self.assertFalse(data['can_confirm'])
        self.assertEqual(data['blocking_errors'], ['STUDENT_CODE_MISMATCH'])
        self.assertEqual(self.confirm(data).json()['error']['code'], 'STUDENT_CODE_MISMATCH')
        self.card(); valid = self.preview()
        self.card('999999999')
        self.assertEqual(self.confirm(valid).json()['error']['code'], 'STUDENT_CODE_MISMATCH')
        self.assertEqual((self.user.student_code, self.user.class_name), ('001IT123', '20T1'))
        self.assertIsNone(self.db.scalar(select(StudentCardReference)))

    def test_same_code_does_not_create_fake_profile_update(self):
        self.card(); self.user.class_name = '22T1'; self.db.commit()
        version = self.user.identity_profile_version
        self.assertEqual(self.confirm(self.preview()).status_code, 200)
        self.assertEqual(self.user.identity_profile_version, version)
        self.assertEqual(self.user.student_code, '001IT123')
        self.assertIsNone(self.db.scalar(select(AuditLog).where(AuditLog.action == 'PROFILE_UPDATED_FROM_STUDENT_CARD')))

    def test_new_verified_card_changes_class_reference_and_avatar_but_not_enrollment(self):
        Class.__table__.create(self.engine); ClassEnrollment.__table__.create(self.engine)
        self.card(); first = self.confirm(self.preview()).json()['data']['reference_version']
        self.card(class_name='22T2'); result = self.confirm(self.preview())
        self.assertEqual(result.status_code, 200, result.text)
        second = result.json()['data']['reference_version']
        self.assertNotEqual(first, second)
        profile = self.profile()
        self.assertEqual((profile['student_code'], profile['class_name']), ('001IT123', '22T2'))
        self.assertEqual(profile['avatar_reference_id'], second)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ClassEnrollment)), 0)

    def test_missing_class_keeps_existing_profile_class(self):
        self.card(); self.assertEqual(self.confirm(self.preview()).status_code, 200)
        self.card(class_name=None); data = self.preview()
        self.assertEqual(data['extracted']['class_status'], 'CLASS_UNREADABLE')
        self.assertEqual(self.confirm(data).status_code, 200)
        self.assertEqual(self.profile()['class_name'], '22T1')

    def test_failure_rolls_back_profile_reference_embedding_and_audit(self):
        self.user.student_code = None; self.user.class_name = '20T1'; self.db.commit()
        self.card('102230057'); data = self.preview()
        before = self.profile()
        with patch.object(self.db, 'commit', side_effect=SQLAlchemyError('private details')):
            response = self.confirm(data)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.profile(), before)
        self.assertIsNone(self.db.scalar(select(StudentCardReference)))
        self.assertIsNone(self.db.scalar(select(StudentFaceEmbedding)))
        self.assertIsNone(self.db.scalar(select(AuditLog).where(AuditLog.action == 'PROFILE_UPDATED_FROM_STUDENT_CARD')))
        self.assertEqual(self.confirm(data).status_code, 200)

    def test_ocr_failure_or_changed_preview_values_never_mutate_profile(self):
        self.user.student_code = None; self.db.commit()
        self.card('102230057'); data = self.preview()
        self.ocr.side_effect = OCRError()
        self.assertEqual(self.confirm(data).json()['error']['code'], 'OCR_FAILED')
        self.ocr.side_effect = None
        self.card('102230058')
        self.assertEqual(self.confirm(data).json()['error']['code'], 'PREVIEW_SUPERSEDED')
        self.assertIsNone(self.user.student_code)
        self.assertIsNone(self.user.class_name)
        self.assertIsNone(self.db.scalar(select(StudentCardReference)))

    def test_duplicate_student_code_rejected_without_activation(self):
        self.user.student_code = None; self.db.commit()
        self.card(self.other.student_code); data = self.preview()
        self.assertEqual(self.confirm(data).json()['error']['code'], 'STUDENT_CODE_EXISTS')
        self.assertIsNone(self.user.student_code)
        self.assertIsNone(self.db.scalar(select(StudentCardReference)))

    def test_admin_profile_and_revoke_keep_confirmed_metadata(self):
        self.card(); self.assertEqual(self.confirm(self.preview()).status_code, 200)
        user = self.client.get(f'/api/v1/users/{self.user.id}', headers=self.headers(self.admin)).json()['data']
        self.assertEqual(user['class_name'], '22T1')
        self.assertEqual(user['student_card_status'], 'VERIFIED')
        endpoint = f'/api/v1/admin/student-cards/{self.user.id}'
        detail = self.client.get(endpoint, headers=self.headers(self.admin)).json()['data']
        result = self.client.post(endpoint+'/revoke', headers=self.headers(self.admin), json={
            'identity_profile_version': detail['identity_profile_version'], 'card_admin_version': detail['card_admin_version'],
            'reference_id': detail['reference']['id'], 'reason': 'Cần cập nhật thẻ.'})
        self.assertEqual(result.status_code, 200, result.text)
        profile = self.profile()
        self.assertEqual((profile['student_code'], profile['class_name']), ('001IT123', '22T1'))
        self.assertEqual(profile['student_card_status'], 'NEEDS_REUPLOAD')
        self.assertIsNone(profile['avatar_url'])
