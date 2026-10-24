from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.entities import Exam, ExamAttempt, ExamQuestion, ExamQuestionDrawRule, ExamStatus, Question, QuestionBank, QuestionDifficulty, QuestionType, StudentCardReference, User, UserRole


@compiles(JSONB, 'sqlite')
@compiles(INET, 'sqlite')
def compile_test_types(_type, _compiler, **_kwargs):
    return 'TEXT'


class QuestionSelectionTests(TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        self.addCleanup(self.engine.dispose)
        @event.listens_for(self.engine, 'connect')
        def setup(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)
        for model in (User, StudentCardReference, QuestionBank, Question, Exam, ExamQuestionDrawRule, ExamQuestion, ExamAttempt):
            model.__table__.create(self.engine)
        self.db = self.enterContext(Session(self.engine, expire_on_commit=False))
        self.teacher, self.other, self.student, self.admin = [User(id=uuid4(), full_name='Test User', email=f'{uuid4()}@example.com', password_hash='unused', role=role, is_active=True) for role in (UserRole.teacher, UserRole.teacher, UserRole.student, UserRole.admin)]
        self.db.add_all([self.teacher, self.other, self.student, self.admin]); self.db.flush()
        self.bank = QuestionBank(id=uuid4(), name='Web', created_by=self.teacher.id, is_active=True)
        self.other_bank = QuestionBank(id=uuid4(), name='Other', created_by=self.other.id, is_active=True)
        self.db.add_all([self.bank, self.other_bank]); self.db.flush()
        self.questions = []
        for difficulty, topic, count in ((QuestionDifficulty.easy, 'HTML', 10), (QuestionDifficulty.medium, 'CSS', 10), (QuestionDifficulty.hard, 'JavaScript', 5)):
            for index in range(count):
                question = Question(id=uuid4(), question_bank_id=self.bank.id, type=QuestionType.mcq_single, content=f'{topic} {index}', difficulty=difficulty, topic=topic, default_points=2, is_active=True)
                self.questions.append(question)
        self.inactive = Question(id=uuid4(), question_bank_id=self.bank.id, type=QuestionType.essay, content='Inactive', difficulty=QuestionDifficulty.hard, default_points=1, is_active=False)
        self.foreign = Question(id=uuid4(), question_bank_id=self.other_bank.id, type=QuestionType.essay, content='Foreign', default_points=1, is_active=True)
        self.db.add_all([*self.questions, self.inactive, self.foreign])
        start = datetime.now(timezone.utc)
        self.exam = Exam(id=uuid4(), title='Draft', created_by=self.teacher.id, start_time=start, end_time=start + timedelta(hours=1), duration_minutes=60, status=ExamStatus.draft)
        self.db.add(self.exam); self.db.commit()
        self.enterContext(patch.dict(app.dependency_overrides, {get_db: lambda: self.db}))
        self.client = self.enterContext(TestClient(app))

    def headers(self, actor=None):
        user = actor or self.teacher
        return {'Authorization': f'Bearer {create_access_token(str(user.id), user.role.value)}'}

    def random(self, body, actor=None, bank=None):
        return self.client.post(f'/api/v1/question-banks/{(bank or self.bank).id}/random-select', json=body, headers=self.headers(actor))

    def save(self, questions, actor=None):
        return self.client.put(f'/api/v1/exams/{self.exam.id}/questions', json={'question_ids': [str(q.id) for q in questions]}, headers=self.headers(actor))

    def test_random_exact_unique_active_bank_scoped_excludes_and_no_writes(self):
        excluded = self.questions[:4]
        result = self.random({'count': 20, 'exclude_ids': [str(q.id) for q in excluded]})
        self.assertEqual(result.status_code, 200, result.text)
        rows = result.json()['data']
        self.assertEqual(len(rows), 20)
        self.assertEqual(len({row['id'] for row in rows}), 20)
        self.assertTrue(all(row['is_active'] and row['question_bank_id'] == str(self.bank.id) for row in rows))
        self.assertFalse({str(q.id) for q in excluded} & {row['id'] for row in rows})
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ExamQuestion)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Exam)), 1)

    def test_difficulty_and_topic_distributions_exact(self):
        for key, counts, field in [('difficulty_counts', {'easy': 2, 'medium': 3, 'hard': 1}, 'difficulty'), ('topic_counts', {'HTML': 2, 'CSS': 3, 'JavaScript': 4}, 'topic')]:
            result = self.random({'count': sum(counts.values()), key: counts})
            self.assertEqual(result.status_code, 200, result.text)
            for value, count in counts.items():
                self.assertEqual(sum(row[field] == value for row in result.json()['data']), count)

    def test_shortage_reports_group_and_does_not_partially_save(self):
        response = self.random({'count': 8, 'difficulty_counts': {'easy': 2, 'hard': 6}})
        self.assertEqual(response.status_code, 400)
        self.assertIn('5 câu khó', response.text)
        self.assertEqual(response.json()['error']['details'][0], {'group': 'hard', 'requested': 6, 'available': 5})
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ExamQuestion)), 0)

    def test_filters_and_unclassified_topics(self):
        rows = self.random({'count': 3, 'topic': 'CSS', 'difficulty': 'medium', 'question_type': 'mcq_single'}).json()['data']
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(q['topic'] == 'CSS' and q['difficulty'] == 'medium' and q['type'] == 'mcq_single' for q in rows))
        self.assertEqual(self.random({'count': 1, 'topic_counts': {'Unknown': 1}}).status_code, 400)

    def test_random_permissions_and_archived_bank(self):
        self.assertEqual(self.random({'count': 1}, self.student).status_code, 403)
        self.assertEqual(self.random({'count': 1}, self.other).status_code, 404)
        self.assertEqual(self.random({'count': 1}, self.admin).status_code, 200)
        self.bank.is_active = False; self.db.commit()
        self.assertEqual(self.random({'count': 1}).status_code, 404)

    def test_invalid_configuration(self):
        for body in ({'count': 0}, {'count': 501}, {'count': 1.5}, {'count': 3, 'difficulty_counts': {'easy': 2}}, {'count': 1, 'difficulty_counts': {'invalid': 1}}, {'count': 1, 'difficulty_counts': {'easy': 1}, 'topic_counts': {'HTML': 1}}, {'count': 1, 'difficulty_counts': {'easy': 1}, 'difficulty': 'easy'}, {'count': 1, 'topic_counts': {'HTML': 1}, 'topic': 'HTML'}, {'count': 1, 'topic_counts': {'HTML': True}}):
            self.assertEqual(self.random(body).status_code, 422, str(body))

    def test_selection_removes_reorders_no_duplicates_preserves_existing_points(self):
        first, second, third = self.questions[:3]
        self.assertEqual(self.save([first, second]).status_code, 200)
        link = self.db.scalar(select(ExamQuestion).where(ExamQuestion.question_id == second.id))
        link.points = Decimal('3.5'); self.db.commit()
        self.assertEqual(self.save([second, third]).status_code, 200)
        links = self.db.scalars(select(ExamQuestion).order_by(ExamQuestion.order_index)).all()
        self.assertEqual([link.question_id for link in links], [second.id, third.id])
        self.assertEqual([link.points for link in links], [Decimal('3.5'), Decimal('1')])
        self.assertEqual(self.save([second, second]).status_code, 422)
        self.assertEqual(self.save([]).status_code, 200)

    def test_selection_rejects_foreign_inactive_missing_and_published_atomically(self):
        self.save(self.questions[:2])
        for actor, chosen, code in ((self.other, self.questions[:1], 403), (self.student, self.questions[:1], 403), (self.teacher, [self.foreign], 403), (self.teacher, [self.inactive], 404)):
            self.assertEqual(self.save(chosen, actor).status_code, code)
            self.assertEqual(self.db.scalar(select(func.count()).select_from(ExamQuestion)), 2)
        self.exam.status = ExamStatus.published; self.db.commit()
        self.assertEqual(self.save(self.questions[2:3]).status_code, 409)

    def test_existing_attempt_locks_even_draft_selection(self):
        now = datetime.now(timezone.utc)
        self.db.add(ExamAttempt(exam_id=self.exam.id, student_id=self.student.id, attempt_number=1, started_at=now, server_deadline_at=now + timedelta(hours=1)))
        self.db.commit()
        self.assertEqual(self.save(self.questions[:1]).status_code, 409)
