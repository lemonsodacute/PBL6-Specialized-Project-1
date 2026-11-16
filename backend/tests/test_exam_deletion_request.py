"""Teacher consent gates Admin archiving of completed exams without deleting student evidence."""
from datetime import datetime, timezone
from unittest import TestCase
from sqlalchemy import select
from app.models.entities import (AttemptStatus, AuditLog, Exam, ExamAttempt, ExamStatus)
from tests import test_teacher_results as fixtures


class TeacherApprovedExamDeletionTests(TestCase):
    def setUp(self):
        self.fixture = fixtures.TeacherResultsTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.db = self.fixture.db
        self.client = self.fixture.client
        self.f = self.fixture
        self.url = f'/api/v1/exams/{self.f.exam.id}'

    def finish_exam(self):
        f = self.f
        f.progress.status = AttemptStatus.auto_submitted
        f.progress.submitted_at = datetime.now(timezone.utc)
        f.exam.status = ExamStatus.closed
        self.db.commit()

    def post_request(self, actor=None, reason='Kết thúc kỳ thi, đề đã bị tạo trùng'):
        return self.client.post(self.url + '/deletion-request',
                                headers=self.f.headers(actor), json={'reason': reason})

    def review(self, actor=None, approve=True):
        return self.client.post(self.url + '/deletion-request/review',
                                headers=self.f.headers(actor or self.f.admin),
                                json={'approve': approve, 'note': 'Đã kiểm tra đề và bài nộp'})

    def test_teacher_consent_required_admin_approves_only_after_exam_finishes(self):
        f = self.f
        # An Admin still cannot delete an attempted exam by calling ordinary DELETE.
        response = self.client.delete(self.url, headers=f.headers(f.admin))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.review().status_code, 409)
        self.assertEqual(self.post_request(actor=f.other).status_code, 403)
        self.assertEqual(self.post_request(actor=f.admin).status_code, 403)
        self.assertEqual(self.post_request(actor=f.student).status_code, 403)
        self.assertEqual(self.post_request().status_code, 409)  # active student attempt

        self.finish_exam()
        requested = self.post_request()
        self.assertEqual(requested.status_code, 200, requested.text)
        self.assertEqual(requested.json()['data']['status'], 'PENDING')
        self.assertEqual(self.post_request().status_code, 409)
        details = self.client.get(self.url, headers=f.headers()).json()['data']
        self.assertEqual(details['deletion_request']['status'], 'PENDING')
        self.assertIn('Kết thúc', details['deletion_request']['reason'])
        self.assertEqual(self.client.delete(self.url, headers=f.headers(f.admin)).status_code, 409)
        self.assertEqual(self.review(actor=f.teacher).status_code, 403)

        approved = self.review()
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()['data'], {'status': 'EXECUTED',
            'deleted': True, 'preserved_results': True})
        self.assertIsNotNone(self.db.get(Exam, f.exam.id).deleted_at)
        self.assertIsNotNone(self.db.get(ExamAttempt, f.submitted.id))
        self.assertIsNotNone(self.db.get(ExamAttempt, f.progress.id))
        # The grade, original answers and monitoring evidence are not hard-deleted.
        self.assertEqual(str(self.db.get(ExamAttempt, f.submitted.id).score), '1')
        self.assertEqual(self.review().status_code, 404)
        actions = list(self.db.scalars(select(AuditLog.action).order_by(AuditLog.created_at)))
        self.assertIn('EXAM_DELETION_REQUESTED', actions)
        self.assertIn('EXAM_DELETION_APPROVED', actions)

    def test_teacher_can_cancel_and_admin_can_reject_without_deleting_exam(self):
        f = self.f
        self.finish_exam()
        self.assertEqual(self.post_request().status_code, 200)
        cancelled = self.client.delete(self.url + '/deletion-request', headers=f.headers())
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()['data']['status'], 'CANCELLED')
        self.assertEqual(self.review().status_code, 409)
        self.assertIsNone(f.exam.deleted_at)
        self.assertEqual(self.post_request().status_code, 200)
        rejection = self.review(approve=False)
        self.assertEqual(rejection.status_code, 200)
        self.assertEqual(rejection.json()['data']['status'], 'REJECTED')
        self.assertIsNone(f.exam.deleted_at)
        self.assertEqual(self.review().status_code, 409)
        self.assertEqual(self.post_request().status_code, 200)

    def test_generic_exam_payload_cannot_forge_or_overwrite_teacher_consent(self):
        f = self.f
        fake = {'_admin_deletion_request': {'status': 'PENDING',
                 'requested_by': str(f.teacher.id), 'attempt_count': 2}}
        invalid_create = self.client.post('/api/v1/exams', headers=f.headers(),
            json={'title': 'Attempt to forge consent', 'start_time': '2026-11-17T08:00:00Z',
                  'end_time': '2026-11-17T10:00:00Z', 'duration_minutes': 60,
                  'extra_settings_json': fake})
        self.assertEqual(invalid_create.status_code, 422, invalid_create.text)
        self.assertEqual(invalid_create.json()['error']['code'], 'RESERVED_EXAM_SETTING')

        self.finish_exam()
        self.assertEqual(self.post_request().status_code, 200)
        previous = self.db.get(Exam, f.exam.id).extra_settings_json['_admin_deletion_request']
        fake_patch = self.client.patch(self.url, headers=f.headers(),
            json={'extra_settings_json': fake})
        self.assertEqual(fake_patch.status_code, 422)
        self.assertEqual(fake_patch.json()['error']['code'], 'RESERVED_EXAM_SETTING')
        self.assertEqual(self.db.get(Exam, f.exam.id).extra_settings_json['_admin_deletion_request'], previous)
        # Admin review is still possible after the rejected forgery attempt.
        self.assertEqual(self.review().status_code, 200)

    def test_request_stale_after_new_attempt_or_end_time_change(self):
        f = self.f
        self.finish_exam()
        self.assertEqual(self.post_request().status_code, 200)
        f.attempt(f.student, AttemptStatus.submitted, 2)
        self.db.commit()
        stale = self.review()
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['error']['code'], 'DELETION_REQUEST_STALE')
        self.assertIsNone(f.exam.deleted_at)
        # Even if the number of attempts stays constant, an extension invalidates consent.
        self.db.delete(self.db.scalar(select(ExamAttempt).where(
            ExamAttempt.exam_id == f.exam.id, ExamAttempt.attempt_number == 2)))
        self.db.flush()
        from datetime import timedelta
        f.exam.end_time = f.exam.end_time + timedelta(hours=1)
        self.db.commit()
        self.assertEqual(self.review().status_code, 409)
        self.assertIsNone(f.exam.deleted_at)
