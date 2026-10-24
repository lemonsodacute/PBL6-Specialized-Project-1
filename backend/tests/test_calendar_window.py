from datetime import datetime, timezone
from unittest import TestCase
from uuid import uuid4

from app.models.entities import Class, Exam, ExamAssignment, ExamStatus, LiveClass
from tests import test_teacher_results as fixtures


class CalendarWindowTests(TestCase):
    def setUp(self):
        self.fixture = fixtures.TeacherResultsTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.db, self.client = self.fixture.db, self.fixture.client
        LiveClass.__table__.create(self.db.get_bind())
        f = self.fixture
        other_class = Class(id=uuid4(), name='Private calendar class', homeroom_teacher_id=f.other.id)
        self.db.add(other_class)
        self.db.flush()
        self.expected_exams, self.expected_classes = set(), set()
        # Visible window: Oct 12 00:00 through Oct 19 00:00 (UTC).
        for title, start, end, visible in (
            ('continuing', '2026-10-11T23:30:00Z', '2026-10-15T23:30:00Z', True),
            ('previous-month', '2026-08-01T00:00:00Z', '2026-10-14T23:30:00Z', True),
            ('inside', '2026-10-13T09:00:00Z', '2026-10-13T10:00:00Z', True),
            ('lower-bound', '2026-10-11T00:00:00Z', '2026-10-12T00:00:00Z', True),
            ('before', '2026-10-10T00:00:00Z', '2026-10-11T23:59:00Z', False),
            ('upper-bound', '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', False),
            ('private', '2026-10-13T09:00:00Z', '2026-10-13T10:00:00Z', False),
        ):
            start_time = datetime.fromisoformat(start.replace('Z', '+00:00'))
            end_time = datetime.fromisoformat(end.replace('Z', '+00:00'))
            private = title == 'private'
            exam = Exam(id=uuid4(), title=f'Calendar {title}', created_by=f.other.id if private else f.teacher.id,
                        start_time=start_time, end_time=end_time, duration_minutes=30, status=ExamStatus.published)
            live = LiveClass(id=uuid4(), title=f'Calendar {title}', class_id=other_class.id if private else f.cls.id,
                             teacher_id=f.other.id if private else f.teacher.id, scheduled_start=start_time,
                             scheduled_end=end_time, status='scheduled')
            self.db.add_all([exam, live])
            self.db.flush()
            if not private:
                self.db.add(ExamAssignment(exam_id=exam.id, student_id=f.student.id))
            if visible:
                self.expected_exams.add(str(exam.id))
                self.expected_classes.add(str(live.id))
        self.db.commit()

    def get(self, endpoint, actor=None, **params):
        return self.client.get(f'/api/v1/{endpoint}', params={
            'q': 'Calendar', 'from_time': '2026-10-12T00:00:00Z', 'to_time': '2026-10-19T00:00:00Z',
            'page': 1, 'limit': 100, **params,
        }, headers=self.fixture.headers(actor or self.fixture.student))

    def test_exam_overlap_includes_old_starts_and_preserves_visibility_and_page_counts(self):
        result = self.get('exams')
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()
        self.assertEqual({row['id'] for row in data['data']}, self.expected_exams)
        self.assertEqual(data['meta']['total'], 4)
        self.assertTrue(all(row['duration_minutes'] == 30 for row in data['data']))
        self.assertEqual(self.get('exams', self.fixture.waiting).json()['data'], [])
        page = self.get('exams', limit=2, page=2).json()
        self.assertEqual(len(page['data']), 2)
        self.assertEqual(page['meta']['total'], 4)

    def test_live_class_overlap_uses_scheduled_window_and_keeps_class_membership(self):
        result = self.get('live-classes')
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()
        self.assertEqual({row['id'] for row in data['data']}, self.expected_classes)
        self.assertEqual(data['meta']['total'], 4)
        self.assertEqual(self.get('live-classes', self.fixture.direct).json()['data'], [])
        page = self.get('live-classes', limit=2, page=2).json()
        self.assertEqual(len(page['data']), 2)
        self.assertEqual(page['meta']['total'], 4)

    def test_calendar_keeps_completed_attempt_and_real_open_close_metadata(self):
        f = self.fixture
        f.exam.title = 'Calendar submitted'
        f.exam.start_time = datetime(2026, 10, 11, 23, 30, tzinfo=timezone.utc)
        f.exam.end_time = datetime(2026, 10, 15, 23, 30, tzinfo=timezone.utc)
        f.exam.duration_minutes = 30
        self.db.commit()
        rows = self.get('exams', q='Calendar submitted').json()['data']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['attempt']['status'], 'submitted')
        self.assertEqual(rows[0]['duration_minutes'], 30)
        self.assertTrue(rows[0]['start_time'].startswith('2026-10-11T23:30'))
        self.assertTrue(rows[0]['end_time'].startswith('2026-10-15T23:30'))
