from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase
from uuid import uuid4
from app.models.entities import (AttemptStatus, DetectionEvent, DetectionEventType, Exam, ExamAttempt,
    ExamStatus, ProctoringSession, SeverityLevel, ViolationLog, ViolationType)
from tests import test_teacher_results as fixtures


class TeacherReportsTests(TestCase):
    def setUp(self):
        self.fixture = fixtures.TeacherResultsTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.db = self.fixture.db
        self.client = self.fixture.client

    def overview(self, exam=None, actor=None):
        url = '/api/v1/teacher/reports' + (f'?exam_id={exam}' if exam else '')
        return self.client.get(url, headers=self.fixture.headers(actor))

    def test_mixed_scales_saved_scores_only_and_real_attempt_count(self):
        f = self.fixture
        f.submitted.score = Decimal('12.5'); f.submitted.max_score = Decimal('15')
        now = datetime.now(timezone.utc)
        other_exam = Exam(id=uuid4(), title='Different scale', created_by=f.teacher.id, start_time=now,
            end_time=now + timedelta(hours=3), duration_minutes=60, status=ExamStatus.published)
        self.db.add(other_exam); self.db.flush()
        self.db.add(ExamAttempt(id=uuid4(), exam_id=other_exam.id, student_id=f.student.id,
            status=AttemptStatus.auto_submitted, attempt_number=1, score=Decimal('14'), max_score=Decimal('17'),
            submitted_at=now, violation_count=0))
        f.attempt(f.student, AttemptStatus.terminated, 2, Decimal('0'))
        f.attempt(f.waiting, AttemptStatus.submitted, score=None)
        f.attempt(f.direct, AttemptStatus.not_started, score=Decimal('999'))
        self.db.commit()
        response = self.overview(); self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']; stats = data['summary']
        self.assertEqual(stats['completed_attempts'], 4)
        self.assertEqual(stats['scored_attempts'], 3)
        self.assertEqual(Decimal(str(stats['average_percentage'])), Decimal('55.23'))
        self.assertIsNone(stats['average_score']); self.assertIsNone(stats['average_risk_score'])
        for row in data['results']:
            if row['status'] in ('in_progress', 'not_started'): self.assertIsNone(row['score'])
        selected = self.overview(other_exam.id).json()['data']
        self.assertEqual(len(selected['exams']), 2)
        self.assertEqual(len(selected['results']), 1)
        self.assertEqual(Decimal(selected['summary']['average_score']), Decimal('14'))
        self.assertEqual(Decimal(selected['summary']['max_score']), Decimal('17'))

    def test_event_records_not_stale_counter_and_same_results_source(self):
        f = self.fixture; f.submitted.violation_count = 99; f.submitted.risk_score = Decimal('38')
        now = datetime.now(timezone.utc)
        session = ProctoringSession(id=uuid4(), attempt_id=f.submitted.id)
        self.db.add(session); self.db.flush()
        self.db.add_all([
            ViolationLog(id=uuid4(), attempt_id=f.submitted.id, type=ViolationType.tab_switch,
                severity=SeverityLevel.low, occurred_at=now),
            DetectionEvent(id=uuid4(), attempt_id=f.submitted.id, proctoring_session_id=session.id,
                event_type=DetectionEventType.face_not_detected, severity=SeverityLevel.medium,
                confidence_score=Decimal('0.9'), occurred_at=now + timedelta(seconds=1)),
        ]); self.db.commit()
        data = self.overview(f.exam.id).json()['data']
        row = next(row for row in data['results'] if row['attempt_id'] == str(f.submitted.id))
        self.assertEqual(row['violation_count'], 2)
        self.assertEqual(data['summary']['total_violations'], 2)
        self.assertEqual(Decimal(row['risk_score']), Decimal('38'))
        self.assertEqual(Decimal(data['summary']['average_risk_score']), Decimal('38'))
        result = f.report().json()['data']
        saved = next(row for row in result['attempts'] if row['attempt_id'] == row['id'] == str(f.submitted.id))
        for field in ('score', 'max_score', 'risk_score', 'violation_count', 'percentage'):
            self.assertEqual(row[field], saved[field])
        detail = self.client.get(f'/api/v1/reports/attempts/{f.submitted.id}', headers=f.headers()).json()['data']
        self.assertEqual(detail['violation_count'], 2)
        self.assertEqual([event['source'] for event in detail['events']], ['browser', 'detector'])
        self.assertEqual(detail['full_name'], f.student.full_name)
        self.assertEqual(detail['student_code'], f.student.student_code)
        self.assertEqual(detail['score'], row['score'])

    def test_modern_yolo_and_gaze_events_counted_but_simulation_excluded(self):
        f = self.fixture
        now = datetime(2026, 11, 17, 9, 0, tzinfo=timezone.utc)
        session = ProctoringSession(id=uuid4(), attempt_id=f.submitted.id)
        self.db.add(session); self.db.flush()
        self.db.add(ViolationLog(id=uuid4(), attempt_id=f.submitted.id,
            type=ViolationType.tab_switch, severity=SeverityLevel.low, occurred_at=now))
        for source, label, simulated in [
            ('LEGACY', 'face_not_detected', False),
            ('OBJECT', 'object_phone', False),
            ('FACE', 'gaze_away', False),
            ('OBJECT', 'object_book', True),
        ]:
            self.db.add(DetectionEvent(id=uuid4(), attempt_id=f.submitted.id,
                proctoring_session_id=session.id, source=source, event_type=label,
                severity=SeverityLevel.medium, is_simulated=simulated,
                occurred_at=now + timedelta(minutes=len(self.db.new))))
        self.db.commit()
        for suffix in ['', '?page=1&limit=1&status=submitted']:
            response = self.client.get(f'/api/v1/teacher/reports{suffix}', headers=f.headers())
            self.assertEqual(response.status_code, 200, response.text)
            overview = response.json()['data']
            self.assertEqual(overview['summary']['browser_violation_count'], 1)
            self.assertEqual(overview['summary']['detection_count'], 3)
            self.assertEqual(overview['summary']['total_violations'], 4)
            attempt = next(row for row in overview['results'] if row['attempt_id'] == str(f.submitted.id))
            self.assertEqual(attempt['detection_count'], 3)
            self.assertEqual(attempt['violation_count'], 4)
        for suffix in ['', '?page=1&limit=20']:
            response = self.client.get(f'/api/v1/reports/attempts/{f.submitted.id}{suffix}',
                                       headers=f.headers())
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()['data']
            self.assertEqual(data['detection_count'], 3)
            self.assertEqual(len(data['events']), 4)
            self.assertEqual({event['type'] for event in data['events'] if event['source'] == 'detector'},
                             {'face_not_detected', 'object_phone', 'gaze_away'})
        # The teacher must never see another teacher's detections in their own report.
        other = self.overview(actor=f.other).json()['data']
        self.assertEqual(other['summary']['detection_count'], 0)

    def test_submission_trend_counts_all_authorized_attempts_not_current_page(self):
        f = self.fixture
        f.submitted.submitted_at = datetime(2026, 11, 16, 18, 0, tzinfo=timezone.utc)
        second = f.attempt(f.student, AttemptStatus.submitted, 2, Decimal('0'))
        second.submitted_at = datetime(2026, 11, 17, 18, 0, tzinfo=timezone.utc)
        self.db.commit()
        response = self.client.get('/api/v1/teacher/reports?page=1&limit=1', headers=f.headers())
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']
        self.assertEqual(len(data['results']), 1)
        self.assertEqual(data['summary']['completed_attempts'], 2)
        self.assertEqual(data['submission_trend'], [
            {'date': '2026-11-17', 'value': 1},
            {'date': '2026-11-18', 'value': 1},
        ])
        full = self.overview().json()['data']
        self.assertEqual(full['submission_trend'], data['submission_trend'])
        self.assertEqual(self.overview(actor=f.other).json()['data']['submission_trend'], [])

    def test_owner_filter_and_direct_url_permissions(self):
        f = self.fixture
        self.assertEqual(self.overview(actor=f.student).status_code, 403)
        self.assertEqual(self.overview(f.exam.id, f.other).status_code, 403)
        self.assertEqual(self.overview(actor=f.other).json()['data']['results'], [])
        self.assertEqual(self.overview(actor=f.other).json()['data']['exams'], [])
        self.assertEqual(self.overview(uuid4()).status_code, 404)
        self.assertEqual(self.overview(actor=f.admin).status_code, 200)
        detail_url = f'/api/v1/reports/attempts/{f.submitted.id}'
        self.assertEqual(self.client.get(detail_url, headers=f.headers(f.other)).status_code, 403)
        self.assertEqual(self.client.get(detail_url, headers=f.headers(f.student)).status_code, 403)
        self.assertEqual(self.client.get(detail_url).status_code, 401)
        self.assertEqual(self.client.get(f'/api/v1/reports/attempts/{uuid4()}', headers=f.headers()).status_code, 404)
        f.exam.deleted_at = datetime.now(timezone.utc); self.db.commit()
        self.assertEqual(self.overview().json()['data']['results'], [])
        self.assertEqual(self.client.get(detail_url, headers=f.headers()).status_code, 404)

    def test_empty_and_missing_max_score_are_not_fabricated(self):
        f = self.fixture
        empty = self.overview(actor=f.other).json()['data']['summary']
        self.assertEqual(empty['completed_attempts'], 0); self.assertEqual(empty['total_violations'], 0)
        self.assertIsNone(empty['average_percentage']); self.assertIsNone(empty['average_risk_score'])
        for maximum in (None, Decimal('0')):
            f.submitted.max_score = maximum; self.db.commit()
            data = self.overview(f.exam.id).json()['data']
            self.assertIsNone(data['summary']['average_percentage'])
            self.assertIsNone(data['summary']['average_score'])
            row = next(row for row in data['results'] if row['attempt_id'] == str(f.submitted.id))
            self.assertEqual(Decimal(row['score']), Decimal('1')); self.assertIsNone(row['percentage'])

    def test_multiple_terminal_attempts_not_collapsed_to_latest_student(self):
        f = self.fixture
        second = f.attempt(f.student, AttemptStatus.auto_submitted, 2, Decimal('0'))
        f.attempt(f.student, AttemptStatus.in_progress, 3); self.db.commit()
        data = self.overview(f.exam.id).json()['data']
        self.assertEqual(data['summary']['completed_attempts'], 2)
        self.assertEqual(Decimal(data['summary']['average_score']), Decimal('0.50'))
        self.assertTrue(any(row['attempt_id'] == str(second.id) for row in data['results']))
        self.assertEqual(data['completed_statuses'], ['submitted', 'auto_submitted', 'terminated'])
