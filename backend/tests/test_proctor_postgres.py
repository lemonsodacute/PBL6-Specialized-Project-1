"""Opt-in transaction checks restricted to the named isolated release QA DB."""
import json
import os
import re
import select as io_select
from datetime import datetime,timezone
from pathlib import Path
from unittest import TestCase,skipUnless
from unittest.mock import patch
from uuid import UUID,uuid4
from sqlalchemy import select
from sqlalchemy.engine import make_url
from app.core.config import settings
from app.core.database import engine,SessionLocal
from app.models.entities import DetectionEvent,ExamAttempt,AttemptStatus
from app.proctoring.contracts import NormalizedProctorEvent
from app.services import proctor_events as domain,proctor_realtime as realtime
from app.services import proctor_lifecycle  # Register commit observers for the lifecycle test.


@skipUnless(os.environ.get('PROCTOR_POSTGRES_TESTS')=='1','Explicit isolated PostgreSQL test only')
class PostgresCommitTests(TestCase):
    def setUp(self):
        self.assertRegex(make_url(settings.DATABASE_URL).database or '',r'^ai_procto_release_qa_[0-9a-f]{16}$')
        self.fixture=json.loads((Path(__file__).resolve().parents[1]/'private/release-qa/proctor-fixture.json').read_text(encoding='utf8'))
        self.enterContext(patch.object(settings,'PROCTOR_SIMULATOR_ENABLED',True))
        self.enterContext(patch.object(settings,'ENVIRONMENT','test'))
        self.connection=engine.raw_connection();self.addCleanup(self.connection.close)
        self.driver=self.connection.driver_connection
        with self.driver.cursor() as cursor:cursor.execute('LISTEN '+realtime.CHANNEL)
        self.driver.commit()

    def notifications(self,timeout=.15):
        if io_select.select([self.driver],[],[],timeout)[0]:self.driver.poll()
        values=[json.loads(message.payload) for message in self.driver.notifies]
        self.driver.notifies.clear()
        return values

    def test_rollback_emits_nothing_commit_publishes_identifiers_and_preserves_scores(self):
        f=self.fixture
        event=NormalizedProctorEvent(external_id=uuid4(),provider='test_simulator',exam_id=f['exam_id'],attempt_id=f['attempt_id'],
            student_id=f['actors']['student']['id'],source='TEST_SIMULATOR',event_type='gaze_away',severity='high',occurred_at=datetime.now(timezone.utc))
        with SessionLocal() as db:
            attempt=db.get(ExamAttempt,UUID(f['attempt_id']))
            before=(attempt.score,attempt.risk_score,attempt.violation_count,attempt.status)
            result=domain.ingest(db,event,mode='simulator');identifier=result.event.id
            realtime.change(db,result.event,'proctor_event_created' if result.created else 'proctor_event_updated')
            self.assertEqual(self.notifications(),[])
            db.rollback();self.assertEqual(self.notifications(),[])
            result=domain.ingest(db,event,mode='simulator')
            message=realtime.change(db,result.event,'proctor_event_created' if result.created else 'proctor_event_updated')
            db.commit()
            messages=self.notifications(2)
            self.assertTrue(any(item['data']['id']==str(result.event.id) for item in messages))
            self.assertNotIn('confidence',messages[0]['data']);self.assertNotIn('student',messages[0]['data'])
            db.refresh(attempt)
            self.assertEqual((attempt.score,attempt.risk_score,attempt.violation_count,attempt.status),before)

    def test_attempt_status_observer_only_publishes_after_commit(self):
        attempt_id=UUID(self.fixture['attempt_id'])
        with SessionLocal() as db:
            attempt=db.get(ExamAttempt,attempt_id);original=attempt.status
            attempt.status=AttemptStatus.submitted;db.flush();db.rollback()
            self.assertEqual(self.notifications(),[])
            attempt=db.get(ExamAttempt,attempt_id);self.assertEqual(attempt.status,original)
            attempt.status=AttemptStatus.submitted;db.commit()
            self.assertTrue(any(item['type']=='attempt_update' and item['data']['attempt_id']==str(attempt_id) for item in self.notifications(2)))
            attempt.status=original;db.commit();self.notifications(2)
