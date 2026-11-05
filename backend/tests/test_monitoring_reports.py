"""Reporting stays scoped to exam, attempt and real/simulator channel."""
from unittest import TestSuite
from datetime import timedelta
from uuid import UUID, uuid4
from app.models.entities import DetectionEvent, Exam, ExamAttempt, AttemptStatus, ExamStatus
from tests.test_proctor_alerts import ProctorAlertsTests


class MonitoringReportTests(ProctorAlertsTests):
    def test_report_review_envelope_does_not_double_academic_browser_warning_count(self):
        f=self.fixture
        result=self.client.post(f'/api/v1/attempts/{f.progress.id}/violations',headers=f.headers(f.active),json={'type':'tab_switch','severity':'low'})
        self.assertEqual(result.status_code,200,result.text)
        listed=self.client.get('/api/v1/attempts/mine',headers=f.headers(f.active)).json()['data']
        row=next(item for item in listed if item['id']==str(f.progress.id))
        self.assertEqual(row['violation_count'],1)

    def test_report_timeline_paginates_all_events_with_stable_tied_timestamps(self):
        event=self.ingest().json()['data']['event'];original=self.db.get(DetectionEvent,UUID(event['id']))
        values={column.name:getattr(original,column.name) for column in DetectionEvent.__table__.columns if column.name!='id'}
        self.db.add_all(DetectionEvent(id=uuid4(),**values) for _ in range(100));self.db.commit()
        path=f'/attempts/{self.fixture.progress.id}/timeline?exam_id={self.fixture.exam.id}'
        first=self.call('GET',path).json()['data'];second=self.call('GET',path+'&page=2').json()['data']
        left={item['id'] for item in first['entries'] if item['kind']=='event'}
        right={item['id'] for item in second['entries'] if item['kind']=='event'}
        self.assertEqual(first['total_events'],101);self.assertTrue(first['truncated']);self.assertFalse(second['truncated'])
        self.assertEqual((len(left),len(right)),(100,1));self.assertFalse(left&right)

    def test_report_attempts_include_zero_alerts_without_unstarted_roster(self):
        event=self.ingest().json()['data']['event']
        data=self.call('GET',f'/exams/{self.fixture.exam.id}/report').json()['data']
        self.assertEqual(data['participating_students'],2)
        self.assertEqual(data['students_with_alerts'],1)
        self.assertEqual(data['total_attempts'],2)
        self.assertEqual(data['attempts'][0]['id'],event['attempt_id'])
        self.assertEqual(data['attempts'][0]['highest_severity'],'high')
        self.assertEqual(data['attempts'][1]['total'],0)
        self.assertIsNone(data['attempts'][1]['highest_severity'])
        self.assertEqual(data['exam']['classes'][0]['id'],str(self.fixture.cls.id))

    def test_report_filters_pagination_and_multiple_attempts_are_independent(self):
        f=self.fixture
        self.ingest()
        another=f.attempt(f.active,AttemptStatus.submitted,number=2);self.db.commit()
        data=self.call('GET',f'/exams/{f.exam.id}/report?limit=1').json()['data']
        self.assertEqual(data['pagination']['total'],3)
        self.assertEqual(data['participating_students'],2)
        filtered=self.call('GET',f'/exams/{f.exam.id}/report?alert_filter=with_alerts&severity=high').json()['data']
        self.assertEqual([x['id'] for x in filtered['attempts']],[str(f.progress.id)])
        self.assertEqual(filtered['summary']['total'],1)
        zero=self.call('GET',f'/exams/{f.exam.id}/report?q=REALCODE01').json()['data']
        self.assertEqual(zero['attempts'][0]['id'],str(f.submitted.id))
        self.assertEqual(zero['attempts'][0]['total'],0)

    def test_report_permissions_and_mismatched_timeline_exam(self):
        f=self.fixture
        for user in (f.active,f.other):
            self.assertEqual(self.call('GET',f'/exams/{f.exam.id}/report',actor=user).status_code,403)
        self.assertEqual(self.call('GET',f'/exams/{f.exam.id}/report',actor=f.admin).status_code,200)
        self.assertEqual(self.call('GET',f'/attempts/{f.progress.id}/timeline?exam_id={uuid4()}').status_code,404)

    def test_report_persists_decisions_and_does_not_change_academic_score(self):
        f=self.fixture;score=f.progress.score
        event=self.ingest().json()['data']['event']
        result=self.call('PATCH',f'/events/{event["id"]}/review',json={'status':'CONFIRMED','expected_version':0,'note':'Human review fixture'})
        self.assertEqual(result.status_code,200,result.text)
        f.exam.status=ExamStatus.closed;self.db.commit()
        data=self.call('GET',f'/exams/{f.exam.id}/report?alert_filter=confirmed').json()['data']
        self.assertEqual(data['attempts'][0]['confirmed'],1)
        self.assertEqual(data['summary']['confirmed'],1)
        timeline=self.call('GET',f'/attempts/{f.progress.id}/timeline?exam_id={f.exam.id}').json()['data']
        self.assertEqual(timeline['summary']['confirmed'],1)
        self.assertTrue(any(item['kind']=='review' for item in timeline['entries']))
        self.db.refresh(f.progress);self.assertEqual(f.progress.score,score)


def load_tests(loader, tests, pattern):
    return TestSuite(MonitoringReportTests(name) for name in loader.getTestCaseNames(MonitoringReportTests) if name.startswith('test_report_'))
