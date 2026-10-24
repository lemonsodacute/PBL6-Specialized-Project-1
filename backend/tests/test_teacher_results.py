from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.entities import (Answer, AttemptStatus, AuditLog, Class, ClassEnrollment, Exam,
                                ExamAssignment, ExamAttempt, ExamQuestion, ExamQuestionDrawRule,
                                ExamStatus, ProctoringSession, Question, QuestionBank, QuestionType,
                                StudentCardReference, User, UserRole, DetectionEvent, ViolationLog)


@compiles(JSONB, 'sqlite')
@compiles(INET, 'sqlite')
def compile_test_types(_type, _compiler, **_kwargs):
    return 'TEXT'


class TeacherResultsTests(TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        self.addCleanup(engine.dispose)
        @event.listens_for(engine, 'connect')
        def configure(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)
            connection.create_function('num_nonnulls', -1, lambda *args: sum(value is not None for value in args))
        for model in (User, StudentCardReference, Class, ClassEnrollment, QuestionBank, Question, Exam,
                      ExamAssignment, ExamQuestionDrawRule, ExamQuestion, ExamAttempt, Answer, AuditLog, ProctoringSession, ViolationLog, DetectionEvent):
            model.__table__.create(engine)
        self.db = self.enterContext(Session(engine, expire_on_commit=False))
        self.teacher, self.other, self.student, self.active, self.waiting, self.direct, self.admin = [
            User(id=uuid4(), full_name=f'Results Test {index}', email=f'{uuid4()}@example.test',
                 password_hash='unused', role=role, is_active=True)
            for index, role in enumerate((UserRole.teacher, UserRole.teacher, UserRole.student,
                                         UserRole.student, UserRole.student, UserRole.student, UserRole.admin))]
        self.student.student_code = 'REALCODE01'
        self.db.add_all([self.teacher, self.other, self.student, self.active, self.waiting, self.direct, self.admin]); self.db.flush()
        self.cls = Class(id=uuid4(), name='Results class', homeroom_teacher_id=self.teacher.id)
        self.db.add(self.cls); self.db.flush()
        for student in (self.student, self.active, self.waiting):
            self.db.add(ClassEnrollment(id=uuid4(), class_id=self.cls.id, student_id=student.id))
        now = datetime.now(timezone.utc)
        self.exam = Exam(id=uuid4(), title='Results exam', created_by=self.teacher.id, start_time=now,
                         end_time=now + timedelta(hours=3), duration_minutes=60, status=ExamStatus.published,
                         max_attempts=3, extra_settings_json={'show_answers': False})
        self.bank = QuestionBank(id=uuid4(), name='Results bank', created_by=self.teacher.id)
        self.db.add_all([self.exam, self.bank]); self.db.flush()
        self.questions = [Question(id=uuid4(), question_bank_id=self.bank.id, type=QuestionType.mcq_single,
                                   content=f'Question {i}', options_json={'options':[{'id':'a','text':'Option A'}, {'id':'b','text':'Option B'}]},
                                   correct_answer_json={'correct_option_id':'a'}, default_points=1, is_active=True) for i in range(2)]
        self.db.add_all(self.questions); self.db.flush()
        for index, question in enumerate(self.questions):
            self.db.add(ExamQuestion(id=uuid4(), exam_id=self.exam.id, question_id=question.id, order_index=index, points=Decimal('1')))
        self.db.add_all([
            ExamAssignment(id=uuid4(), exam_id=self.exam.id, class_id=self.cls.id),
            ExamAssignment(id=uuid4(), exam_id=self.exam.id, student_id=self.student.id),
            ExamAssignment(id=uuid4(), exam_id=self.exam.id, student_id=self.direct.id),
        ])
        self.submitted = self.attempt(self.student, AttemptStatus.submitted, score=Decimal('1'))
        self.progress = self.attempt(self.active, AttemptStatus.in_progress, score=Decimal('2'))
        self.db.add(Answer(id=uuid4(), attempt_id=self.submitted.id, question_id=self.questions[0].id,
                           answer_content={'selected_option_id':'a'}, is_correct=True, points_awarded=Decimal('1')))
        self.db.commit()
        self.enterContext(patch.dict(app.dependency_overrides, {get_db:lambda: self.db}))
        self.client = self.enterContext(TestClient(app))

    def headers(self, actor=None):
        actor = actor or self.teacher
        return {'Authorization':f'Bearer {create_access_token(str(actor.id), actor.role.value)}'}

    def attempt(self, student, status, number=1, score=None):
        now = datetime.now(timezone.utc)
        attempt = ExamAttempt(id=uuid4(), exam_id=self.exam.id, student_id=student.id, attempt_number=number,
                              status=status, score=score, max_score=Decimal('2'), started_at=now,
                              server_deadline_at=now + timedelta(hours=1),
                              submitted_at=now if status != AttemptStatus.in_progress else None,
                              violation_count=0)
        self.db.add(attempt); self.db.flush()
        return attempt

    def report(self, actor=None):
        return self.client.get(f'/api/v1/exams/{self.exam.id}/report', headers=self.headers(actor))

    def test_roster_real_identity_scores_counts_dedup_and_unstarted(self):
        response = self.report(); self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']
        self.assertEqual(data['summary'], dict(student_count=4, submitted_count=1, in_progress_count=1, not_started_count=2))
        rows = {row['student_id']:row for row in data['results']}
        submitted = rows[str(self.student.id)]
        self.assertEqual(submitted['full_name'], self.student.full_name)
        self.assertEqual(submitted['student_code'], 'REALCODE01')
        self.assertEqual(Decimal(submitted['score']), self.submitted.score)
        self.assertEqual(submitted['correct_count'], 1)
        self.assertEqual(submitted['total_questions'], 2)
        for student in (self.waiting, self.direct):
            self.assertEqual(rows[str(student.id)]['status'], 'not_started')
            self.assertIsNone(rows[str(student.id)]['attempt_id']); self.assertIsNone(rows[str(student.id)]['score'])
        self.assertIsNone(rows[str(self.active.id)]['score'])
        self.assertIsNone(rows[str(self.active.id)]['correct_count'])
        self.assertEqual(data['exam']['classes'][0]['name'], self.cls.name)
        self.assertEqual(Decimal(data['exam']['max_score']), Decimal('2'))

    def test_latest_attempt_matches_student_summary_and_preserves_all_history(self):
        second = self.attempt(self.student, AttemptStatus.submitted, 2, Decimal('0')); self.db.commit()
        data = self.report().json()['data']; row = next(row for row in data['results'] if row['student_id'] == str(self.student.id))
        self.assertEqual(row['attempt_id'], str(second.id)); self.assertEqual(Decimal(row['score']), 0)
        self.assertEqual([attempt['attempt_number'] for attempt in row['attempts']], [2, 1])
        third = self.attempt(self.student, AttemptStatus.in_progress, 3); self.db.commit()
        row = next(row for row in self.report().json()['data']['results'] if row['student_id'] == str(self.student.id))
        self.assertEqual(row['attempt_id'], str(third.id)); self.assertIsNone(row['score']); self.assertEqual(len(row['attempts']), 3)

    def test_ownership_student_denial_missing_and_deleted_exam(self):
        self.assertEqual(self.report(self.other).status_code, 403)
        self.assertEqual(self.report(self.student).status_code, 403)
        self.assertEqual(self.report(self.admin).status_code, 200)
        self.assertEqual(self.client.get(f'/api/v1/exams/{uuid4()}/report', headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.get(f'/api/v1/exams/{self.exam.id}/report').status_code, 401)
        self.exam.deleted_at = datetime.now(timezone.utc); self.db.commit()
        self.assertEqual(self.report().status_code, 404)

    def test_detail_reuses_saved_answers_score_and_teacher_keys_without_student_policy_change(self):
        url = f'/api/v1/attempts/{self.submitted.id}/result'
        teacher = self.client.get(url, headers=self.headers()).json()['data']
        student = self.client.get(url, headers=self.headers(self.student)).json()['data']
        self.assertEqual(teacher['student']['student_code'], self.student.student_code)
        self.assertEqual(teacher['score'], student['score'])
        self.assertEqual(teacher['questions'][0]['student_answer'], {'selected_option_id':'a'})
        self.assertEqual(teacher['questions'][0]['correct_answer'], {'correct_option_id':'a'})
        self.assertTrue(teacher['questions'][0]['is_correct']); self.assertIsNotNone(teacher['questions'][0]['answer_id'])
        self.assertFalse(student['show_answers']); self.assertIsNone(student['questions'][0]['correct_answer'])
        self.assertEqual(self.client.get(url, headers=self.headers(self.other)).status_code, 403)
        self.assertEqual(self.client.get(url, headers=self.headers(self.waiting)).status_code, 404)
        self.assertEqual(self.client.get(f'/api/v1/attempts/{self.progress.id}/result', headers=self.headers()).status_code, 409)

    def test_real_submit_persists_and_next_report_reads_fresh_score(self):
        self.db.add(Answer(id=uuid4(), attempt_id=self.progress.id, question_id=self.questions[0].id,
                           answer_content={'selected_option_id':'a'})); self.db.commit()
        with patch('app.api.v1.attempts.notify_teachers_of_exam'):
            response = self.client.post(f'/api/v1/attempts/{self.progress.id}/submit', headers=self.headers(self.active))
        self.assertEqual(response.status_code, 200, response.text)
        self.db.expire_all()
        saved = self.db.get(ExamAttempt, self.progress.id)
        self.assertEqual(saved.status, AttemptStatus.submitted); self.assertIsNotNone(saved.submitted_at)
        self.assertEqual(saved.score, Decimal('1')); self.assertEqual(saved.max_score, Decimal('2'))
        answer = self.db.scalar(select(Answer).where(Answer.attempt_id == saved.id))
        self.assertTrue(answer.is_correct); self.assertEqual(answer.points_awarded, Decimal('1'))
        row = next(row for row in self.report().json()['data']['results'] if row['student_id'] == str(self.active.id))
        self.assertEqual(row['status'], 'submitted'); self.assertEqual(Decimal(row['score']), saved.score)

    def test_student_explicit_and_closed_exam_answer_key_policy_is_preserved(self):
        url = f'/api/v1/attempts/{self.submitted.id}/result'
        self.exam.extra_settings_json = {'show_answers': True}; self.db.commit()
        self.assertTrue(self.client.get(url, headers=self.headers(self.student)).json()['data']['show_answers'])
        self.exam.status = ExamStatus.closed
        self.exam.extra_settings_json = {'show_answers': False}; self.db.commit()
        self.assertFalse(self.client.get(url, headers=self.headers(self.student)).json()['data']['show_answers'])
        self.exam.extra_settings_json = {}; self.db.commit()
        self.assertTrue(self.client.get(url, headers=self.headers(self.student)).json()['data']['show_answers'])

    def test_terminal_variants_and_historical_enrollment(self):
        for status in (AttemptStatus.auto_submitted, AttemptStatus.terminated):
            self.submitted.status = status; self.db.commit()
            data = self.report().json()['data']; self.assertEqual(data['summary']['submitted_count'], 1)
            self.assertEqual(next(row for row in data['results'] if row['student_id'] == str(self.student.id))['status'], status.value)
        self.db.delete(self.db.scalar(select(ClassEnrollment).where(ClassEnrollment.student_id == self.active.id)))
        self.db.commit()
        self.assertTrue(any(row['student_id'] == str(self.active.id) for row in self.report().json()['data']['results']))

    def test_unanswered_manual_question_is_not_fabricated_as_incorrect(self):
        self.questions[1].type = QuestionType.essay
        self.db.add(Answer(id=uuid4(), attempt_id=self.submitted.id, question_id=self.questions[1].id,
                           answer_content='Essay response', points_awarded=None)); self.db.commit()
        row = next(row for row in self.report().json()['data']['results'] if row['student_id'] == str(self.student.id))
        self.assertEqual(row['pending_manual_count'], 1); self.assertEqual(row['objective_question_count'], 1)
        self.assertEqual(row['correct_count'], 1); self.assertEqual(Decimal(row['score']), Decimal('1'))
