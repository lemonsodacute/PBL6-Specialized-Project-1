"""Academic reporting contracts against the existing isolated application fixtures.

No live accounts, grades or proctor events are created by this suite.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from unittest import TestCase
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.exc import SQLAlchemyError

from app.models.entities import (Answer, AttemptStatus, AuditLog, Class, ClassEnrollment, DetectionEvent,
    Exam, ExamAssignment, ExamAttempt, ExamStatus, ProctoringSession, QuestionType, SupportSession, SupportTurn, User)
from app.services import support_academic as academic, support_academic_queries as reports
from app.services.monitoring_reports import student_alert_summary
from tests import test_support_academic as fixtures


class AcademicExpansionTests(TestCase):
    def setUp(self):
        fixtures.AcademicSupportTests.setUp(self)
        self.presentation = self.enterContext(patch('app.api.v1.support_assistant.format_academic_answer',
            side_effect=lambda answer, result, intent: answer))
    headers = fixtures.AcademicSupportTests.headers
    attempt = fixtures.AcademicSupportTests.attempt
    start = fixtures.AcademicSupportTests.start
    act = fixtures.AcademicSupportTests.act
    data = fixtures.AcademicSupportTests.data
    ask = fixtures.AcademicSupportTests.ask

    def lookup(self, text, actor=None, **updates):
        query = academic.detect_lookup(text)
        self.assertIsNotNone(query, text)
        return academic.execute_lookup(self.db, actor or self.teacher, query.model_copy(update=updates))

    def test_requested_intents_and_entities(self):
        cases = {
            'STUDENT_ATTEMPT_HISTORY': ['Châu Anh đã làm những bài nào?', 'Cho tôi xem lịch sử làm bài của Châu Anh',
                'MSSV 102220123 đã làm những đề nào?', 'Châu Anh đã thi mấy bài?', 'Còn lịch sử làm bài?'],
            'STUDENTS_NOT_ATTEMPTED': ['Sinh viên nào chưa làm bài giữa kỳ?', 'Ai chưa thi SQL?',
                'Cho tôi danh sách sinh viên chưa làm đề này', 'Bài nào tôi chưa làm?', 'Ai chưa nộp?'],
            'STUDENTS_BELOW_SCORE': ['Ai có điểm dưới 5?', 'Sinh viên nào dưới 5 điểm bài giữa kỳ?',
                'Cho tôi danh sách sinh viên dưới 50%', 'ai dưới 5 điểm giữa kỳ Web?'],
            'EXAM_SUBMISSION_SUMMARY': ['Lớp này có bao nhiêu sinh viên đã nộp bài?',
                'Bài giữa kỳ có bao nhiêu người đã làm?', 'Còn bao nhiêu sinh viên chưa nộp?'],
            'OPEN_EXAMS_LOOKUP': ['Bài kiểm tra nào đang mở?', 'Hôm nay có đề nào đang diễn ra?',
                'Lớp Web hiện có bài nào làm được?'],
            'STUDENT_PROCTOR_ALERT_SUMMARY': ['Sinh viên nào có nhiều cảnh báo giám sát nhất?',
                'Châu Anh có bao nhiêu cảnh báo?', 'Ai có cảnh báo mức cao trong bài giữa kỳ?',
                'Cho tôi xem các sinh viên có cảnh báo chưa xử lý'],
            'CLASS_SCORE_SUMMARY': ['Điểm trung bình lớp Web là bao nhiêu?', 'Lớp này học thế nào?',
                'Cho tôi thống kê điểm lớp', 'Cho tôi thống kê lớp Lập trình Web - Nhóm 1'],
            'EXAM_RESULT_SUMMARY': ['Thống kê kết quả bài giữa kỳ', 'Điểm trung bình đề SQL là bao nhiêu?',
                'Có bao nhiêu sinh viên đạt trên 8?'],
        }
        for intent, examples in cases.items():
            for text in examples:
                with self.subTest(text=text):
                    self.assertEqual(academic.detect_lookup(text).intent, intent)
        self.assertEqual(academic.detect_lookup('ai dưới 5 điểm giữa kỳ Web?').exam_query, 'giua ky web')
        self.assertEqual(academic.detect_lookup('Điểm trung bình lớp Web là bao nhiêu?').class_query, 'web')
        self.assertEqual(academic.detect_lookup('Điểm trung bình đề SQL là bao nhiêu?').exam_query, 'sql')
        self.assertEqual(academic.detect_lookup('Châu Anh có bao nhiêu cảnh báo?').student_name, 'chau anh')
        combined = academic.detect_lookup('Ai dưới 50% lớp Web trong bài giữa kỳ?')
        self.assertEqual(combined.class_query, 'web'); self.assertEqual(combined.exam_query, 'giua ky')
        self.assertEqual(self.lookup('Ai dưới 50% lớp Web trong bài giữa kỳ?')['status'], 'report')

    def test_history_and_how_to_regression(self):
        for text in ['Châu Anh đã làm những bài nào?', 'MSSV 102220123 đã làm những đề nào?', 'Châu Anh đã thi mấy bài?']:
            result = self.lookup(text)
            self.assertEqual(result['status'], 'results')
            self.assertEqual(result['results'][0]['exam_name'], 'SQL giữa kỳ')
            self.assertIn('started_at', result['results'][0]); self.assertIn('submitted_at', result['results'][0])
            self.assertEqual(Decimal(result['results'][0]['score']), self.submitted.score)
        for text in ['Làm sao xem lịch sử làm bài?', 'Làm sao xem sinh viên chưa nộp?',
                'Làm sao xem báo cáo giám sát?', 'Làm sao xem điểm lớp?', 'Làm sao xem sinh viên chưa làm bài?']:
            self.assertIsNone(academic.detect_lookup(text))
        self.assertEqual(self.lookup('Lịch sử làm bài của tôi', self.student)['student']['id'], str(self.student.id))
        self.assertEqual(self.lookup('Lịch sử làm bài của Châu Anh', self.waiting)['status'], 'denied')

    def test_not_attempted_is_current_roster_and_real_lifecycle(self):
        result = self.lookup('Sinh viên nào chưa làm bài giữa kỳ?')['data']
        self.assertIn(str(self.waiting.id), [r['student_id'] for r in result['rows']])
        self.assertNotIn(str(self.student.id), [r['student_id'] for r in result['rows']])
        self.assertNotIn(str(self.active.id), [r['student_id'] for r in result['rows']])
        self.assertNotIn(str(self.stranger.id), [r['student_id'] for r in result['rows']])
        # A placeholder is not an actual attempt; an earlier real attempt still is.
        self.attempt(self.waiting, AttemptStatus.not_started, number=1)
        self.attempt(self.student, AttemptStatus.not_started, number=2)
        self.db.commit()
        ids = [r['student_id'] for r in self.lookup('Ai chưa thi SQL?')['data']['rows']]
        self.assertIn(str(self.waiting.id), ids); self.assertNotIn(str(self.student.id), ids)
        not_submitted = self.lookup('Ai chưa nộp bài SQL?')['data']
        self.assertIn(str(self.active.id), [r['student_id'] for r in not_submitted['rows']])

    def test_point_and_percentage_thresholds_use_persisted_final_scores(self):
        self.submitted.score = Decimal('8'); self.submitted.max_score = Decimal('20')
        self.db.commit()
        below_points = self.lookup('Ai dưới 5 điểm bài SQL?')['data']
        below_percent = self.lookup('Ai dưới 50% bài SQL?')['data']
        self.assertEqual(below_points['total'], 0)
        self.assertEqual(below_percent['total'], 1)
        row = below_percent['rows'][0]
        self.assertEqual(Decimal(row['score']), 8); self.assertEqual(Decimal(row['max_score']), 20)
        self.assertEqual(Decimal(row['percentage']), 40)
        self.assertEqual(self.lookup('Ai dưới 40% bài SQL?')['data']['total'], 0)
        self.assertEqual(self.lookup('Có bao nhiêu sinh viên đạt trên 7 điểm bài SQL?')['data']['threshold_result']['total'], 1)
        self.assertEqual(self.lookup('Ai dưới 101%?')['status'], 'scope_error')

    def test_submission_summary_counts_real_states_and_does_not_finalize(self):
        self.progress.server_deadline_at = datetime.now(timezone.utc) - timedelta(hours=1)
        self.db.commit()
        data = self.lookup('Bài giữa kỳ có bao nhiêu người đã làm?')['data']
        self.assertEqual(data['submitted'], 1); self.assertEqual(data['in_progress'], 1)
        self.assertEqual(data['started'], 2)
        self.assertEqual(data['total_enrolled'], data['started'] + data['not_attempted'])
        self.submitted.status = AttemptStatus.auto_submitted; self.db.commit()
        data = self.lookup('Bài giữa kỳ có bao nhiêu người đã làm?')['data']
        self.assertEqual(data['submitted'], 0); self.assertEqual(data['auto_submitted'], 1)
        self.db.refresh(self.progress)
        self.assertEqual(self.progress.status, AttemptStatus.in_progress)

    def test_class_and_exam_statistics_do_not_invent_a_pass_threshold(self):
        self.submitted.score = 8; self.submitted.max_score = 20; self.exam.passing_score = None
        self.db.commit()
        data = self.lookup('Điểm trung bình lớp Web là bao nhiêu?')['data']
        self.assertEqual(data['graded_students'], 1); self.assertEqual(data['graded_count'], 1)
        self.assertEqual(Decimal(data['average']), 8)
        self.assertEqual(Decimal(data['median']), 8)
        self.assertIsNone(data['pass_count']); self.assertIsNone(data['fail_count'])
        self.exam.passing_score = 10; self.db.commit()
        data = self.lookup('Thống kê kết quả bài giữa kỳ')['data']
        self.assertEqual(data['pass_count'], 0); self.assertEqual(data['fail_count'], 1)
        self.assertEqual(data['attempt_count'], 2)
        self.assertEqual(data['submitted_count'], 1)

    def test_open_exams_obey_backend_time_status_and_student_availability(self):
        now = datetime.now(timezone.utc)
        self.exam.start_time = now - timedelta(minutes=5); self.exam.end_time = now + timedelta(hours=1)
        self.exam.status = ExamStatus.published; self.db.commit()
        with patch.object(reports, 'backend_now', return_value=now):
            self.assertEqual(self.lookup('Hôm nay có đề nào đang diễn ra?')['data']['total'], 1)
            self.assertEqual(self.lookup('Bài kiểm tra nào đang mở?', self.waiting)['data']['total'], 1)
            self.assertEqual(self.lookup('Bài kiểm tra nào đang mở?', self.student)['data']['total'], 0)
            for field, value in [('status', ExamStatus.closed), ('status', ExamStatus.draft),
                    ('start_time', now + timedelta(minutes=1)), ('end_time', now)]:
                old = getattr(self.exam, field); setattr(self.exam, field, value); self.db.commit()
                self.assertEqual(self.lookup('Bài kiểm tra nào đang mở?')['data']['total'], 0)
                setattr(self.exam, field, old); self.db.commit()

    def test_student_self_unattempted_and_teacher_only_reports(self):
        result = self.lookup('Bài nào tôi chưa làm?', self.waiting)
        self.assertTrue(result['data']['self_only']); self.assertEqual(result['data']['total'], 1)
        self.assertEqual(self.lookup('Bài nào tôi chưa làm?', self.student)['data']['total'], 0)
        for text in ['Ai dưới 5?', 'Thống kê kết quả bài giữa kỳ', 'Điểm trung bình lớp Web',
                'Bài SQL có bao nhiêu người đã làm?', 'Châu Anh có bao nhiêu cảnh báo?']:
            self.assertEqual(self.lookup(text, self.waiting)['status'], 'denied')
        for intent in ['STUDENTS_NOT_ATTEMPTED', 'STUDENTS_BELOW_SCORE', 'EXAM_RESULT_SUMMARY',
                'EXAM_SUBMISSION_SUMMARY', 'STUDENT_PROCTOR_ALERT_SUMMARY']:
            result = academic.execute_lookup(self.db, self.other, academic.Lookup(intent=intent, exam_id=self.exam.id, threshold=5))
            self.assertEqual(result['status'], 'no_scope')
        with self.assertRaises(HTTPException):
            reports.get_exam_submission_summary(self.db, self.other, self.exam, academic.Lookup())

    def test_safe_conversation_context_and_new_conversation_isolation(self):
        session = self.ask('Điểm của Châu Anh')
        history = self.ask('Còn lịch sử làm bài?', session=session)
        self.assertIn('SQL giữa kỳ', history['messages'][-1]['assistant_text'])
        self.assertNotIn('data_context', history['summary'])
        fresh = self.start(self.teacher, fresh=True)
        response = self.ask('Còn lịch sử làm bài?', session=fresh)
        self.assertIn('sinh viên nào', response['messages'][-1]['assistant_text'])
        session = self.ask('Cho tôi thống kê lớp Lập trình Web - Nhóm 1')
        followup = self.ask('Ai chưa nộp?', session=session)
        self.assertIn('SQL giữa kỳ', followup['messages'][-1]['assistant_text'])
        self.cls.homeroom_teacher_id = self.other.id; self.db.commit()
        denied = self.ask('Ai chưa nộp?', session=followup)
        self.assertNotIn(self.waiting.full_name, denied['messages'][-1]['assistant_text'])

    def test_ambiguity_no_match_and_choices_reauthorize(self):
        other_exam = Exam(id=uuid4(), title='SQL giữa kỳ nhóm 2', created_by=self.teacher.id,
            status=ExamStatus.closed, start_time=self.exam.start_time, end_time=self.exam.end_time, duration_minutes=45)
        self.db.add(other_exam); self.db.commit()
        session = self.ask('Ai dưới 50%?')
        choices = session['messages'][-1]['sources'][0]['choices']
        self.assertEqual(len(choices), 2)
        selected = next(c for c in choices if str(self.exam.id) in c['value'])
        response = self.ask(selected['value'], session=session)
        self.assertIn('SQL giữa kỳ', response['messages'][-1]['assistant_text'])
        self.assertEqual(self.lookup('Ai chưa thi KhôngTồnTại?')['status'], 'no_scope')
        other_exam.created_by = self.other.id; self.db.commit()
        foreign = next(c for c in choices if str(other_exam.id) in c['value'])
        denied = self.ask(foreign['value'], session=session)
        self.assertNotIn('nhóm 2', denied['messages'][-1]['assistant_text'])

    def event(self, student, attempt, severity='high', status='NEW', simulated=False):
        session = self.db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt.id))
        if not session:
            session = ProctoringSession(id=uuid4(), attempt_id=attempt.id)
            self.db.add(session); self.db.flush()
        event = DetectionEvent(id=uuid4(), proctoring_session_id=session.id, exam_id=self.exam.id, student_id=student.id, attempt_id=attempt.id,
            event_type='multiple_faces', severity=severity, status=status, source='MULTI_PERSON',
            provider='unit-fixture', occurred_at=datetime.now(timezone.utc), is_simulated=simulated)
        self.db.add(event); self.db.flush()
        return event

    def test_proctor_summary_reuses_persisted_events_and_human_review_language(self):
        self.event(self.student, self.submitted, status='CONFIRMED')
        self.event(self.student, self.submitted, severity='low', status='DISMISSED')
        self.event(self.student, self.submitted, severity='critical')
        self.event(self.student, self.submitted, simulated=True)
        self.event(self.active, self.progress, status='REVIEWED'); self.db.commit()
        result = self.lookup('Châu Anh có bao nhiêu cảnh báo?')
        row = result['data']['students'][0]
        self.assertEqual(row['total'], 3); self.assertEqual(row['highest_severity'], 'critical')
        self.assertEqual((row['confirmed'], row['dismissed'], row['new']), (1, 1, 1))
        self.assertEqual(row['attempts'][0]['attempt_id'], str(self.submitted.id))
        text, sources, _ = academic.format_result(result, academic.detect_lookup('Châu Anh có bao nhiêu cảnh báo?'))
        self.assertNotIn('gian lận', text)
        self.assertIn('giảng viên là người đánh giá cuối cùng', text)
        self.assertEqual(sources[0]['route'], f'/dashboard/monitor/{self.exam.id}')
        top = self.lookup('Sinh viên nào có nhiều cảnh báo nhất?')['data']['students']
        self.assertEqual([r['student_id'] for r in top], [str(self.student.id)])
        unresolved = self.lookup('Sinh viên có cảnh báo chưa xử lý')['data']['students']
        self.assertEqual(len(unresolved), 2)
        with self.assertRaises(HTTPException):
            student_alert_summary(self.db, self.other, [self.exam.id])
        with self.assertRaises(HTTPException):
            student_alert_summary(self.db, self.student, [self.exam.id])
        self.assertEqual(self.submitted.score, Decimal('1'))

    def test_empty_alerts_errors_no_bulk_export_and_sanitized_audit(self):
        empty = self.lookup('Châu Anh có bao nhiêu cảnh báo?')
        self.assertEqual(empty['data']['total_students'], 0)
        self.assertEqual(self.lookup('xuất toàn bộ dữ liệu tất cả sinh viên')['status'], 'scope_error')
        with patch.object(reports, 'get_exam_submission_summary', side_effect=SQLAlchemyError('private connection secret')):
            session = self.ask('Bài SQL có bao nhiêu người đã làm?')
        self.assertEqual(session['phase'], 'UNAVAILABLE')
        self.assertNotIn('private connection', session['messages'][-1]['assistant_text'])
        self.assertFalse(session['messages'][-1]['used_provider'])
        retry = self.data(self.act(session, 'retry', self.teacher))
        self.assertEqual(retry['phase'], 'DATA')
        audits = self.db.scalars(select(AuditLog).where(AuditLog.action == 'AI_SUPPORT_DATA_ACCESS')).all()
        self.assertTrue(audits)
        for row in audits:
            self.assertNotIn(self.student.full_name, json.dumps(row.metadata_json))

    def test_date_windows_use_vietnam_backend_calendar(self):
        now = datetime(2026, 10, 27, 18, tzinfo=timezone.utc)
        start, end = reports.date_window('today', now)
        self.assertEqual(start, datetime(2026, 10, 27, 17, tzinfo=timezone.utc))
        self.assertEqual(end - start, timedelta(days=1))
        self.assertEqual(reports.date_window('week', now)[0].astimezone(reports.LOCAL_ZONE).weekday(), 0)
        self.assertEqual(reports.date_window('month', now)[0].astimezone(reports.LOCAL_ZONE).day, 1)

    def test_mixed_scales_latest_attempt_median_and_pending_grading(self):
        self.submitted.score = 8; self.submitted.max_score = 10
        other = self.attempt(self.waiting, AttemptStatus.submitted, score=Decimal('16')); other.max_score = 20
        self.db.commit()
        data = self.lookup('Thống kê kết quả bài SQL')['data']
        self.assertEqual(data['scale'], 'percent')
        for field in ('average', 'median', 'highest', 'lowest'):
            self.assertEqual(Decimal(data[field]), 80)
        self.assertEqual(self.lookup('Ai dưới 80% bài SQL?')['data']['total'], 0)
        self.assertEqual(self.lookup('Ai dưới 81% bài SQL?')['data']['total'], 2)
        # Latest is the report policy, not a best-score guess.
        latest = self.attempt(self.student, AttemptStatus.submitted, number=2, score=Decimal('2')); latest.max_score = 10
        self.db.commit()
        data = self.lookup('Thống kê kết quả bài SQL')['data']
        self.assertEqual(Decimal(data['average']), 50); self.assertEqual(Decimal(data['median']), 50)
        self.questions[1].type = QuestionType.essay
        self.db.add(Answer(id=uuid4(), attempt_id=other.id, question_id=self.questions[1].id, points_awarded=None))
        self.db.commit()
        data = self.lookup('Thống kê kết quả bài SQL')['data']
        self.assertEqual(data['graded_count'], 1)
        self.assertEqual(self.lookup('Ai dưới 99% bài SQL?')['data']['total'], 1)

    def test_unknown_or_zero_max_score_is_not_normalized(self):
        self.submitted.max_score = 0; self.db.commit()
        self.assertEqual(self.lookup('Ai dưới 99% bài SQL?')['data']['total'], 0)
        data = self.lookup('Thống kê kết quả bài SQL')['data']
        self.assertIsNone(data['average']); self.assertIsNone(data['median'])
        self.assertEqual(data['graded_count'], 1); self.assertEqual(data['normalized_count'], 0)

    def test_class_scope_excludes_direct_only_students_and_historical_outsiders(self):
        direct = self.attempt(self.direct, AttemptStatus.submitted, score=Decimal('2'))
        historical = self.attempt(self.stranger, AttemptStatus.submitted, score=Decimal('1'))
        self.db.commit()
        result = self.lookup('Ai chưa thi SQL?', class_id=self.cls.id)['data']
        self.assertEqual([r['student_id'] for r in result['rows']], [str(self.waiting.id)])
        data = self.lookup('Điểm trung bình lớp Web')['data']
        self.assertEqual(data['graded_students'], 1)
        # Existing exam reports retain historical participants; class reports use
        # current class membership, and unattempted lists use current assignments.
        self.assertEqual(self.lookup('Thống kê kết quả bài SQL')['data']['graded_students'], 3)

    def test_followup_does_not_reuse_failed_identity_or_unrelated_explicit_scope(self):
        session = self.ask('Điểm của Châu Anh')
        session = self.ask('Điểm của Không Tồn Tại', session=session)
        session = self.ask('Còn lịch sử làm bài?', session=session)
        self.assertIn('sinh viên nào', session['messages'][-1]['assistant_text'])
        context = {'student_id': str(self.student.id), 'class_id': str(self.cls.id), 'exam_id': str(self.exam.id)}
        resolved = academic.resolve_context(academic.detect_lookup('Thống kê kết quả bài Khác'), context)
        self.assertIsNone(resolved.class_id); self.assertIsNone(resolved.exam_id)
        self.assertEqual(resolved.exam_query, 'khac')

    def test_saved_roster_response_is_redacted_after_student_access_is_revoked(self):
        session = self.ask('Ai chưa thi SQL?')
        self.assertIn(self.waiting.full_name, session['messages'][-1]['assistant_text'])
        enrollment = self.db.scalar(select(ClassEnrollment).where(ClassEnrollment.class_id == self.cls.id,
            ClassEnrollment.student_id == self.waiting.id))
        self.db.delete(enrollment); self.db.commit()
        restored = self.client.get(f"/api/v1/support-assistant/sessions/{session['id']}", headers=self.headers(self.teacher)).json()['data']
        self.assertNotIn(self.waiting.full_name, restored['messages'][-1]['assistant_text'])
        self.assertEqual(restored['messages'][-1]['sources'], [])

    def test_alert_filters_types_ties_and_bounded_attempt_links(self):
        self.event(self.student, self.submitted, status='CONFIRMED')
        self.event(self.active, self.progress, severity='critical', status='REVIEWED')
        self.db.commit()
        top = self.lookup('Sinh viên nào có nhiều cảnh báo nhất?')['data']
        self.assertEqual(top['total_students'], 2)
        filtered = self.lookup('Ai có cảnh báo mức cao trong bài SQL?')['data']
        self.assertEqual(filtered['total_students'], 2)
        result = self.lookup('Ai có cảnh báo đã xác nhận theo loại trong bài SQL?')
        self.assertEqual(result['data']['total_students'], 1)
        self.assertEqual(result['data']['students'][0]['types'], [{'type': 'multiple_faces', 'count': 1}])
        for number in range(2, 7):
            attempt = self.attempt(self.student, AttemptStatus.submitted, number=number)
            self.event(self.student, attempt)
        self.db.commit()
        result = self.lookup('Châu Anh có bao nhiêu cảnh báo?')
        row = result['data']['students'][0]
        self.assertEqual(row['attempt_count'], 6); self.assertEqual(len(row['attempts']), 3)
        _, sources, _ = academic.format_result(result, academic.detect_lookup('Châu Anh có bao nhiêu cảnh báo?'))
        self.assertEqual(len(sources[0]['links']), 3)
        self.assertTrue(all(link['route'].startswith(f'/dashboard/monitor/{self.exam.id}/') for link in sources[0]['links']))

    def test_result_and_scope_limits_and_numeric_input_validation(self):
        self.assertEqual(self.lookup('Ai dưới 9999999999999 điểm?')['status'], 'scope_error')
        for index in range(51):
            exam = Exam(id=uuid4(), title=f'Extra exam {index}', created_by=self.teacher.id, status=ExamStatus.closed,
                start_time=self.exam.start_time, end_time=self.exam.end_time, duration_minutes=45)
            self.db.add(exam); self.db.flush()
            self.db.add(ExamAssignment(id=uuid4(), exam_id=exam.id, class_id=self.cls.id))
        self.db.commit()
        result = self.lookup('Điểm trung bình lớp Web')
        self.assertEqual(result['status'], 'choose_scope'); self.assertEqual(len(result['choices']), academic.MAX_CHOICES)
        self.assertTrue(result['more'])

    def test_provider_formats_only_authorized_results_and_cannot_invent_facts(self):
        from app.services.ai_provider import AIProviderError
        self.ask('Thống kê kết quả bài SQL')
        self.presentation.assert_called_once()
        self.presentation.reset_mock()
        self.ask('Thống kê kết quả bài KhôngTồnTại')
        self.presentation.assert_not_called()
        self.presentation.side_effect = AIProviderError('AI_INVALID_RESPONSE')
        result = self.ask('Thống kê kết quả bài SQL')
        self.assertEqual(result['phase'], 'DATA')
        self.assertIn('Trung bình', result['messages'][-1]['assistant_text'])
        self.assertTrue(result['messages'][-1]['used_provider'])
        with patch('app.api.v1.support_assistant.provider_budget_available', return_value=False):
            result = self.ask('Thống kê kết quả bài SQL')
            self.assertFalse(result['messages'][-1]['used_provider'])
            self.assertIn('Trung bình', result['messages'][-1]['assistant_text'])

    def test_presentation_plan_requires_exact_coverage_and_anonymizes_identity(self):
        from app.services.support_academic_presentation import format_academic_answer
        from app.services.ai_provider import AIProviderError
        answer = 'Tổng hợp\n• Nguyễn Châu Anh — MSSV 102220123: 8/20\n• Thấp nhất: 8/20\nGiảng viên đánh giá cuối cùng.'
        result = {'student_name': 'Nguyễn Châu Anh', 'student_code': '102220123'}
        with patch('app.services.support_academic_presentation.OpenAICompatibleClient') as provider:
            provider.return_value.complete.return_value = '{"order":[1,0],"spacing":"compact"}'
            text = format_academic_answer(answer, result, 'EXAM_RESULT_SUMMARY')
            self.assertEqual(sorted(text.splitlines()), sorted(answer.splitlines()))
            sent = json.dumps(provider.return_value.complete.call_args.kwargs['messages'], ensure_ascii=False)
            self.assertNotIn('Nguyễn Châu Anh', sent); self.assertNotIn('102220123', sent)
            for invalid in ['{"order":[0],"spacing":"compact"}', '{"order":[0,0],"spacing":"compact"}',
                    '{"order":[0,1],"spacing":"compact","score":999}', 'Generated fake scores']:
                provider.return_value.complete.return_value = invalid
                with self.assertRaises(AIProviderError):
                    format_academic_answer(answer, result, 'EXAM_RESULT_SUMMARY')
