from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.exc import SQLAlchemyError

from app.models.entities import (Answer, AuditLog, Class, ClassEnrollment, Exam, ExamAssignment, ExamAttempt, ExamStatus,
    AttemptStatus, QuestionType, SupportArticle, SupportSession, User, UserRole)
from app.services import support_academic as academic
from app.services.support_assistant_provider import Selection
from app.main import app
from tests import test_support_assistant as assistant


@asynccontextmanager
async def isolated_lifespan(_app):
    # REST dependencies use the fixture database; unrelated application workers
    # must not connect to the developer's PostgreSQL/LiveKit during these tests.
    yield


class AcademicSupportTests(TestCase):
    headers = assistant.SupportAssistantTests.headers
    attempt = assistant.SupportAssistantTests.attempt
    start = assistant.SupportAssistantTests.start
    act = assistant.SupportAssistantTests.act
    data = assistant.SupportAssistantTests.data

    def setUp(self):
        self.enterContext(patch.object(app.router, 'lifespan_context', isolated_lifespan))
        assistant.SupportAssistantTests.setUp(self)
        self.enterContext(patch('app.api.v1.support_assistant.format_academic_answer',
            side_effect=lambda answer, result, intent: answer))
        self.student.full_name = 'Nguyễn Châu Anh'; self.student.student_code = '102220123'
        self.exam.title = 'SQL giữa kỳ'
        self.cls.name = 'Lập trình Web - Nhóm 1'
        self.stranger = User(id=uuid4(), full_name='Trần Hải Bình', student_code='102220999',
            email=f'{uuid4()}@example.test', password_hash='unused', role=UserRole.student, is_active=True)
        self.foreign_class = Class(id=uuid4(), name='Lớp riêng B', homeroom_teacher_id=self.other.id)
        self.db.add_all([self.stranger, self.foreign_class]); self.db.flush()
        self.db.add(ClassEnrollment(id=uuid4(), class_id=self.foreign_class.id, student_id=self.stranger.id))
        now = datetime.now(timezone.utc)
        self.foreign_exam = Exam(id=uuid4(), title='Private teacher B exam', created_by=self.other.id,
            start_time=now, end_time=now + timedelta(hours=1), duration_minutes=45, status=ExamStatus.closed)
        self.db.add(self.foreign_exam); self.db.flush()
        for student in (self.stranger, self.student):
            self.db.add(ExamAttempt(id=uuid4(), exam_id=self.foreign_exam.id, student_id=student.id,
                attempt_number=1, status=AttemptStatus.submitted, score=Decimal('9.91'), max_score=10,
                submitted_at=now, created_at=now, updated_at=now))
        self.db.commit()

    def ask(self, text, actor=None, session=None):
        actor = actor or self.teacher
        return self.data(self.act(session or self.start(actor), 'message', actor, text=text))

    def test_requested_vietnamese_variants_read_persisted_results_without_rag_provider(self):
        session = self.start(self.teacher)
        variants = ['cho tôi xem điểm của sinh viên châu anh', 'điểm của Châu Anh',
            'Châu Anh được bao nhiêu điểm?', 'kết quả thi của Nguyễn Châu Anh',
            'xem kết quả của MSSV 102220123', 'điểm giữa kỳ của Châu Anh',
            'điểm SQL của Châu Anh', 'điểm môn Lập trình Web của Châu Anh',
            'Châu Anh làm bài SQL được bao nhiêu?', 'Châu Anh được bao nhiêu điểm giữa kỳ?',
            'CHO TOI XEM DIEM CUA SINH VIEN CHAU ANH', 'điểm của Châu Anh trong lớp Lập trình Web']
        with patch('app.api.v1.support_assistant.get_support_provider') as provider:
            for query in variants:
                with self.subTest(query=query):
                    data = self.ask(query, session=session); turn = data['messages'][-1]
                    self.assertEqual(data['phase'], 'DATA', turn)
                    self.assertIn('SQL giữa kỳ', turn['assistant_text'])
                    self.assertRegex(turn['assistant_text'], r'1(?:\.0+)?/2(?:\.0+)?')
                    self.assertNotIn('Private teacher', turn['assistant_text'])
                    self.assertNotIn('9.91', turn['assistant_text'])
                    # Presentation obeys the shared quota; factual contents never
                    # depend on the model, and the RAG provider is not consulted.
                    self.assertIsInstance(turn['used_provider'], bool)
                    self.assertEqual(turn['sources'][0]['kind'], 'system_data')
            provider.assert_not_called()
        self.assertEqual(self.submitted.score, Decimal('1'))
        self.assertEqual(self.progress.status, AttemptStatus.in_progress)

    def test_how_to_and_score_calculation_still_use_rag(self):
        with patch('app.api.v1.support_assistant.get_support_provider') as provider:
            provider.return_value.answer.return_value = Selection(article_ids=['teacher-5'], needs_admin=False)
            for query in ['làm sao xem điểm sinh viên?', 'giáo viên xem lịch sử làm bài ở đâu?']:
                data = self.ask(query)
                self.assertEqual(data['phase'], 'FEEDBACK')
                self.assertTrue(data['messages'][-1]['used_provider'])
                self.assertNotIn('kind', data['messages'][-1]['sources'][0])
            self.assertEqual(provider.return_value.answer.call_count, 2)
        for query in ['Điểm được tính như thế nào?', 'Hướng dẫn xem kết quả', 'Hệ thống giám sát hoạt động như thế nào?']:
            self.assertIsNone(academic.detect_lookup(query))

    def test_duplicate_names_require_mssv_and_reauthorize_selection(self):
        self.waiting.full_name = 'Trần Châu Anh'; self.waiting.student_code = '102220184'
        self.db.commit()
        session = self.ask('điểm SQL của Châu Anh')
        turn = session['messages'][-1]
        self.assertIn('2 sinh viên', turn['assistant_text'])
        self.assertNotRegex(turn['assistant_text'], r'\d+/\d+')
        self.assertEqual(len(turn['sources'][0]['choices']), 2)
        data = self.ask('MSSV 102220123', session=session)
        self.assertIn('SQL giữa kỳ', data['messages'][-1]['assistant_text'])
        self.assertRegex(data['messages'][-1]['assistant_text'], r'1(?:\.0+)?/2(?:\.0+)?')
        self.assertNotIn('102220123', data['messages'][-1]['user_text'])  # existing transcript redaction

    def test_no_match_never_falls_back_to_documentation(self):
        with patch('app.api.v1.support_assistant.get_support_provider') as provider:
            for query in ['điểm của Không Tồn Tại', 'điểm của Trần Hải Bình', 'điểm của MSSV 102220999']:
                data = self.ask(query)
                self.assertIn('Không tìm thấy sinh viên', data['messages'][-1]['assistant_text'])
                self.assertNotIn('9.91', str(data['messages']))
            provider.assert_not_called()

    def test_missing_student_accepts_a_name_followup_and_invalid_choices_reprompt(self):
        with patch('app.api.v1.support_assistant.get_support_provider') as provider:
            session = self.ask('cho tôi xem điểm')
            self.assertIn('sinh viên nào', session['messages'][-1]['assistant_text'])
            session = self.ask('Châu Anh', session=session)
            self.assertIn('SQL giữa kỳ', session['messages'][-1]['assistant_text'])
            self.waiting.full_name = 'Trần Châu Anh'; self.db.commit()
            session = self.ask('điểm của Châu Anh')
            session = self.ask('99', session=session)
            self.assertEqual(len(session['messages'][-1]['sources'][0]['choices']), 2)
            provider.assert_not_called()

    def test_tool_calls_cannot_escape_teacher_or_student_scope(self):
        query = academic.Lookup(student_id=self.stranger.id)
        self.assertEqual(academic.search_authorized_students(self.db, self.teacher, query)['status'], 'not_found')
        self.assertEqual(academic.get_student_results(self.db, self.teacher, query, self.stranger.id)['status'], 'not_found')
        self.assertEqual(academic.get_student_results(self.db, self.student, query, self.stranger.id)['status'], 'not_found')
        other_exam = academic.get_student_results(self.db, self.teacher, academic.Lookup(exam_id=self.foreign_exam.id), self.student.id)
        self.assertEqual(other_exam['results'], [])
        with self.assertRaises(HTTPException):
            academic.get_student_results(self.db, self.admin, academic.Lookup(), self.student.id)
        for actor in (self.other, self.student):
            session = self.start(self.teacher)
            self.assertEqual(self.act(session, 'message', actor, text='điểm của Châu Anh').status_code, 404)
        self.assertEqual(self.client.post('/api/v1/support-assistant/sessions', headers=self.headers(self.admin), json={}).status_code, 403)

    def test_student_only_reads_own_final_scores_and_not_other_students(self):
        data = self.ask('Cho tôi xem điểm của tôi', self.student)
        self.assertIn('Nguyễn Châu Anh', data['messages'][-1]['assistant_text'])
        self.assertRegex(data['messages'][-1]['assistant_text'], r'1(?:\.0+)?/2(?:\.0+)?')
        for query in ['điểm của Trần Hải Bình', 'điểm của MSSV 102220999']:
            data = self.ask(query, self.student)
            self.assertIn('chính mình', data['messages'][-1]['assistant_text'])
            self.assertNotIn('Trần Hải Bình', data['messages'][-1]['assistant_text'])
            self.assertNotIn('9.91', data['messages'][-1]['assistant_text'])

    def test_pending_unsubmitted_and_draft_results_are_not_student_score_claims(self):
        self.questions[0].type = QuestionType.essay
        answer = self.db.scalar(select(Answer).where(Answer.attempt_id == self.submitted.id))
        answer.points_awarded = None
        self.foreign_exam.status = ExamStatus.draft
        self.db.commit()
        student = self.ask('điểm của tôi', self.student)['messages'][-1]['assistant_text']
        self.assertIn('Đang chấm', student)
        self.assertNotRegex(student, r'1(?:\.0+)?/2(?:\.0+)?')
        self.assertNotIn('9.91', student)
        teacher = self.ask('điểm của Châu Anh')['messages'][-1]['assistant_text']
        self.assertIn('điểm hiện có, đang chấm', teacher)
        self.progress.score = Decimal('1.77'); self.db.commit()
        direct = academic.get_student_results(self.db, self.teacher, academic.Lookup(), self.active.id)
        self.assertIsNone(direct['results'][0]['score'])

    def test_exam_and_class_disambiguation_preserves_student_and_permissions(self):
        now = datetime.now(timezone.utc)
        second = Exam(id=uuid4(), title='SQL cuối kỳ', created_by=self.teacher.id,
            start_time=now, end_time=now + timedelta(hours=1), duration_minutes=45, status=ExamStatus.closed)
        self.db.add(second); self.db.flush()
        self.db.add(ExamAttempt(id=uuid4(), exam_id=second.id, student_id=self.student.id, attempt_number=1,
            status=AttemptStatus.submitted, score=Decimal('6.25'), max_score=10, created_at=now))
        self.db.commit()
        session = self.ask('điểm SQL của Châu Anh')
        choices = session['messages'][-1]['sources'][0]['choices']
        self.assertEqual(len(choices), 2)
        chosen = next(c['value'] for c in choices if 'cuối kỳ' in c['label'])
        session = self.ask(chosen, session=session)
        self.assertIn('6.25/10', session['messages'][-1]['assistant_text'])
        self.assertNotIn('giữa kỳ', session['messages'][-1]['assistant_text'])
        # Remove exam management after choice creation; selection is reauthorized.
        session = self.ask('điểm SQL của Châu Anh')
        second.created_by = self.other.id; self.db.commit()
        session = self.ask(chosen, session=session)
        self.assertNotIn('6.25', session['messages'][-1]['assistant_text'])
        self.assertNotIn('6.25', str(session['messages']))

    def test_history_uses_real_statuses_and_provider_failure_does_not_affect_data(self):
        with patch('app.api.v1.support_assistant.get_support_provider', side_effect=AssertionError('No LLM for data')):
            data = self.ask('cho tôi xem lịch sử làm bài của Châu Anh')
            turn = data['messages'][-1]
            self.assertIn('Đã nộp', turn['assistant_text'])
            self.assertEqual(turn['sources'][0]['intent'], 'STUDENT_ATTEMPT_HISTORY')

    def test_tool_failure_is_safe_and_retry_preserves_redacted_mssv(self):
        with patch('app.services.support_academic.execute_lookup', side_effect=SQLAlchemyError('private database details')), \
             patch('app.api.v1.support_assistant.get_support_provider') as provider:
            session = self.ask('xem kết quả của MSSV 102220123')
            self.assertEqual(session['phase'], 'UNAVAILABLE')
            self.assertIn('không thể truy xuất', session['messages'][-1]['assistant_text'])
            self.assertNotIn('private database', str(session))
            self.assertNotIn('data_retry', session['summary'])
            provider.assert_not_called()
        result = self.data(self.act(session, 'retry', self.teacher))
        self.assertIn('SQL giữa kỳ', result['messages'][-1]['assistant_text'])
        self.assertEqual(result['phase'], 'DATA')

    def test_audit_is_metadata_only_and_no_grades_are_indexed(self):
        before = self.db.scalar(select(func.count()).select_from(SupportArticle))
        data = self.ask('điểm của Châu Anh')
        logs = self.db.scalars(select(AuditLog).where(AuditLog.action == 'AI_SUPPORT_DATA_ACCESS')).all()
        self.assertEqual({log.metadata_json['tool'] for log in logs}, {'search_authorized_students', 'get_student_results'})
        for log in logs:
            self.assertEqual(log.user_id, self.teacher.id)
            self.assertIsNotNone(log.created_at)
            self.assertNotIn('score', log.metadata_json)
            self.assertNotIn('Châu Anh', str(log.metadata_json))
        self.assertEqual(self.db.scalar(select(func.count()).select_from(SupportArticle)), before)
        self.exam.created_by = self.other.id; self.db.commit()
        restored = self.client.get(f"/api/v1/support-assistant/sessions/{data['id']}", headers=self.headers(self.teacher)).json()['data']
        self.assertIn('không còn', restored['messages'][-1]['assistant_text'])
        self.assertEqual(restored['messages'][-1]['sources'], [])

    def test_limits_and_no_result_never_fabricate_scores(self):
        for number in range(2, 24):
            self.attempt(self.student, AttemptStatus.submitted, number, Decimal('0'))
        self.db.commit()
        result = academic.get_student_results(self.db, self.teacher, academic.Lookup(), self.student.id)
        self.assertEqual(len(result['results']), 20); self.assertTrue(result['more'])
        empty = academic.get_student_results(self.db, self.teacher, academic.Lookup(), self.waiting.id)
        self.assertEqual(empty['results'], [])
        text, _, _ = academic.format_result(empty, academic.Lookup())
        self.assertIn('Chưa có lượt làm bài', text)

    def test_active_exam_still_blocks_chat_data_and_extra_role_claims_are_rejected(self):
        self.assertEqual(self.client.post('/api/v1/support-assistant/sessions', headers=self.headers(self.active), json={}).status_code, 403)
        session = self.start(self.student)
        self.assertEqual(self.act(session, 'message', text='điểm của tôi', role='teacher').status_code, 422)

    def test_closing_and_escalating_does_not_turn_data_into_kb_sources(self):
        session = self.ask('điểm của Châu Anh')
        with patch('app.api.v1.support_assistant.provider_configured', return_value=False):
            escalated = self.data(self.act(session, 'escalate', self.teacher))
        self.assertEqual(escalated['summary']['articles'], [])
        self.assertEqual(escalated['summary']['steps'], [])
        self.assertEqual(escalated['status'], 'ESCALATED')

    def test_ambiguous_class_requires_selection_and_expired_attempts_remain_unchanged(self):
        second_class = Class(id=uuid4(), name='Lập trình Web - Nhóm 2', homeroom_teacher_id=self.teacher.id)
        self.db.add(second_class); self.db.flush()
        self.db.add(ClassEnrollment(id=uuid4(), class_id=second_class.id, student_id=self.student.id))
        self.db.add(ExamAssignment(id=uuid4(), exam_id=self.exam.id, class_id=second_class.id))
        self.progress.server_deadline_at = datetime.now(timezone.utc) - timedelta(hours=1)
        self.db.commit()
        session = self.ask('điểm của Châu Anh trong lớp Lập trình Web')
        choices = session['messages'][-1]['sources'][0]['choices']
        self.assertEqual(len(choices), 2)
        selected = self.ask(choices[0]['value'], session=session)
        self.assertIn('SQL giữa kỳ', selected['messages'][-1]['assistant_text'])
        academic.get_student_results(self.db, self.teacher, academic.Lookup(), self.active.id)
        self.db.flush(); self.db.refresh(self.progress)
        self.assertEqual(self.progress.status, AttemptStatus.in_progress)
        self.assertEqual(self.progress.score, Decimal('2'))
