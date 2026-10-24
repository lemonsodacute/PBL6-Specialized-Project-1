import asyncio
import logging
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import StaticPool
from app.core.performance import install_request_timing
from app.models.entities import Answer, Class, ClassEnrollment, QuestionBank, Question, QuestionType, AttemptStatus
from tests import test_teacher_results as fixtures


class RequestTimingTests(TestCase):
    def test_development_timing_counts_queries_without_logging_parameters_or_ids(self):
        engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        self.addCleanup(engine.dispose)
        app = FastAPI()
        @app.get('/items/{item_id}')
        async def read(item_id: str):
            with engine.connect() as db:
                db.execute(text('select :secret'), {'secret': 'private-value-not-for-logs'})
            await asyncio.sleep(0.51)
            return {'ok': True}
        install_request_timing(app, engine, enabled=True)
        # Alembic's fileConfig in earlier PostgreSQL tests disables existing
        # loggers. Isolate this assertion from that process-global test state.
        with patch.object(logging.getLogger('app.performance'), 'disabled', False), self.assertLogs('app.performance', level='WARNING') as logs, TestClient(app) as client:
            response = client.get('/items/private-identifier?token=private-query')
        self.assertIn('1 queries', response.headers['server-timing'])
        self.assertIn('receive_epoch_ms', response.headers['x-development-timing'])
        self.assertIn('path=/items/{item_id}', logs.output[0])
        self.assertNotIn('private-', logs.output[0])

    def test_production_installs_no_timing_headers(self):
        app = FastAPI()
        @app.get('/')
        def read(): return {'ok': True}
        install_request_timing(app, None, enabled=False)
        with TestClient(app) as client:
            response = client.get('/')
        self.assertNotIn('server-timing', response.headers)
        self.assertNotIn('x-development-timing', response.headers)


class ListQueryBudgetTests(TestCase):
    def setUp(self):
        self.fixture = fixtures.TeacherResultsTests(); self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.db, self.client = self.fixture.db, self.fixture.client

    def counted_get(self, path, actor=None):
        statements = []
        def count(_connection, _cursor, statement, _parameters, _context, _many):
            if statement.lstrip().upper().startswith('SELECT'): statements.append(1)
        engine = self.db.get_bind(); event.listen(engine, 'before_cursor_execute', count)
        try: response = self.client.get('/api/v1'+path, headers=self.fixture.headers(actor))
        finally: event.remove(engine, 'before_cursor_execute', count)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), len(statements)

    def test_classes_and_banks_keep_bounded_queries_as_page_grows(self):
        for index in range(20):
            cls = Class(id=uuid4(), name=f'Performance {index}', homeroom_teacher_id=self.fixture.teacher.id)
            bank = QuestionBank(id=uuid4(), name=f'Performance {index}', created_by=self.fixture.teacher.id)
            self.db.add_all([cls, bank]); self.db.flush()
            self.db.add(ClassEnrollment(class_id=cls.id, student_id=self.fixture.student.id))
            self.db.add(Question(id=uuid4(), question_bank_id=bank.id, type=QuestionType.mcq_single, content='Performance', default_points=1))
        self.db.commit()
        for path, budget in [('/classes', 8), ('/question-banks', 6)]:
            small, first = self.counted_get(path+'?page=1&limit=5')
            large, second = self.counted_get(path+'?page=1&limit=20')
            self.assertEqual(len(large['data']), 20)
            self.assertLessEqual(second, budget)
            self.assertLessEqual(second, first+1)
            for row in large['data']:
                if row['name'].startswith('Performance'):
                    self.assertEqual(row.get('students_count', row.get('questions_count')), 1)

    def test_history_retains_safe_answers_and_score_with_batched_metadata(self):
        self.fixture.exam.max_attempts = 30
        for number in range(2, 22):
            item = self.fixture.attempt(self.fixture.student, AttemptStatus.submitted, number=number, score=Decimal('1'))
            self.db.add(Answer(id=uuid4(), attempt_id=item.id, question_id=self.fixture.questions[0].id,
                               answer_content={'selected_option_id': 'a'}, is_correct=True, points_awarded=Decimal('1')))
        self.db.commit()
        result, queries = self.counted_get('/attempts/mine?page=1&limit=20', self.fixture.student)
        self.assertEqual(len(result['data']), 20)
        self.assertLessEqual(queries, 36)  # Includes the unchanged per-attempt expiration lock/check.
        self.assertTrue(all(float(item['score']) == 1 for item in result['data']))
        self.assertTrue(all(item['final_score'] == item['score'] and not item['grading_pending'] for item in result['data']))
        self.assertTrue(all(len(item['answers']) == 1 for item in result['data']))
        self.assertTrue(all(answer['is_correct'] is None and answer['points_awarded'] is None for item in result['data'] for answer in item['answers']))
