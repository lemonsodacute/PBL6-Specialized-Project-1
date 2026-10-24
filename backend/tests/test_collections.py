from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch
from sqlalchemy.orm import Session
from uuid import uuid4
from app.models.entities import (AuditLog, Class, ClassEnrollment, ExamAssignment, LiveClass,ViolationLog,SeverityLevel,
    Notification, NotificationType, QuestionDifficulty, User, UserRole, UserSettings)
from tests import test_teacher_results as fixtures

class CollectionQueryTests(TestCase):
    def setUp(self):
        self.fixture=fixtures.TeacherResultsTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.db=self.fixture.db;self.client=self.fixture.client
        from app.models.entities import StudentCardPreview, SupportConversation
        for model in (UserSettings,SupportConversation,Notification,LiveClass,StudentCardPreview): model.__table__.create(self.db.get_bind())
        self.students=[]
        for index in range(45):
            student=User(id=uuid4(),full_name=f'Nguyễn Thiên Đức {index:02}',email=f'collection-{index}@example.test',
                         password_hash='unused',role=UserRole.student,student_code=f'COL{index:03}',is_active=index%2==0,
                         identity_profile_status='VERIFIED' if index%3==0 else 'PENDING',
                         identity_verified_at=datetime.now(timezone.utc) if index%3==0 else None,
                         identity_verified_by=self.fixture.admin.id if index%3==0 else None)
            self.db.add(student);self.students.append(student)
        self.db.flush()
        for student in self.students:
            self.db.add(ClassEnrollment(id=uuid4(),class_id=self.fixture.cls.id,student_id=student.id))
        self.db.commit()

    def get(self,path,actor=None):
        return self.client.get('/api/v1'+path,headers=self.fixture.headers(actor))

    def test_users_full_dataset_accent_search_combined_filters_and_counts(self):
        response=self.get('/users?q=  thien duc  &role=student&page=2&limit=20&sort=name',self.fixture.admin)
        self.assertEqual(response.status_code,200,response.text)
        data=response.json();self.assertEqual(data['meta']['total'],45);self.assertEqual(len(data['data']),20)
        first=self.get('/users?q=THIÊN ĐỨC&role=student&page=1&limit=20&sort=name',self.fixture.admin).json()
        self.assertFalse(set(row['id'] for row in first['data']) & set(row['id'] for row in data['data']))
        response=self.get('/users?q=thien duc&role=student&is_active=true&identity_profile_status=VERIFIED&page=1&limit=100',self.fixture.admin)
        data=response.json();self.assertEqual(data['meta']['total'],8)
        self.assertTrue(all(row['role']=='student' and row['is_active'] and row['identity_profile_status']=='VERIFIED' for row in data['data']))
        self.assertEqual(self.get('/users?q=thien duc').status_code,403)

    def test_literal_wildcards_and_validation(self):
        target=self.students[0];target.full_name='Tên 100% _';self.db.commit()
        data=self.get('/users?q=%25&limit=100',self.fixture.admin).json()
        self.assertEqual(data['meta']['total'],1);self.assertEqual(data['data'][0]['id'],str(target.id))
        for suffix in ('page=0','limit=101','sort=invalid','role=unknown'):
            self.assertEqual(self.get('/users?'+suffix,self.fixture.admin).status_code,422)

    def test_classes_and_enrollments_use_scope_search_and_page_metadata(self):
        f=self.fixture
        for index in range(24):self.db.add(Class(id=uuid4(),name=f'Lớp dữ liệu {index:02}',homeroom_teacher_id=f.teacher.id))
        self.db.add(Class(id=uuid4(),name='Lớp dữ liệu riêng',homeroom_teacher_id=f.other.id));self.db.commit()
        result=self.get('/classes?q=du lieu&page=2&limit=20&sort=name').json()
        self.assertEqual(result['meta']['total'],24);self.assertEqual(len(result['data']),4)
        result=self.get(f'/classes/{f.cls.id}/enrollments?q=thien duc&page=3&limit=20').json()
        self.assertEqual(result['meta']['total'],45);self.assertEqual(len(result['data']),5)
        self.assertIn('student_code',result['data'][0]['student'])
        self.assertEqual(self.get(f'/classes/{f.cls.id}/enrollments?q=thien duc',f.other).status_code,404)
        self.assertEqual(self.get(f'/classes/{f.cls.id}/enrollments',f.student).status_code,403)

    def test_question_filters_and_bank_metadata_do_not_load_all_questions(self):
        f=self.fixture;f.questions[0].content='Phân tích dữ liệu';f.questions[0].difficulty=QuestionDifficulty.easy;f.questions[0].topic='Clustering';self.db.commit()
        response=self.get(f'/question-banks/{f.bank.id}/questions?q=du lieu&type=mcq_single&difficulty=easy&topic=Clustering&page=1&limit=20')
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertEqual(data['meta']['total'],1);self.assertEqual(data['meta']['topics'],['Clustering'])
        detail=self.get(f'/question-banks/{f.bank.id}?include_questions=false').json()['data']
        self.assertEqual(detail['questions_count'],2);self.assertEqual(detail['questions'],[])
        self.assertEqual(self.get(f'/question-banks/{f.bank.id}/questions?q=du lieu',f.other).status_code,404)

    def test_results_page_counts_entire_roster_and_preserves_latest_attempt(self):
        f=self.fixture
        response=self.get(f'/exams/{f.exam.id}/report?q=thien duc&page=2&limit=20&sort=name')
        self.assertEqual(response.status_code,200,response.text);data=response.json()['data']
        self.assertEqual(data['meta']['total'],45);self.assertEqual(len(data['results']),20)
        self.assertEqual(data['summary']['not_started_count'],45)
        response=self.get(f'/exams/{f.exam.id}/report?status=submitted&page=1&limit=20')
        data=response.json()['data'];self.assertEqual(data['meta']['total'],1)
        self.assertEqual(data['results'][0]['attempt_id'],str(f.submitted.id))
        self.assertEqual(self.get(f'/exams/{f.exam.id}/report?q=thien duc&page=2',f.other).status_code,403)

    def test_exam_filters_are_and_and_never_expand_teacher_or_student_scope(self):
        f=self.fixture;f.exam.description='Khai phá dữ liệu';f.exam.require_camera=True;self.db.commit()
        response=self.get(f'/exams?q=khai pha&status=published&class_id={f.cls.id}&require_camera=true&page=1&limit=20')
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertEqual(data['meta']['total'],1)
        self.assertEqual(data['data'][0]['attempt_count'],2)
        self.assertEqual(data['data'][0]['completed_attempt_count'],1)
        self.assertEqual(self.get('/exams?q=khai pha',f.other).json()['meta']['total'],0)
        self.assertEqual(self.get('/exams?q=khai pha&require_camera=false').json()['meta']['total'],0)
        self.assertEqual(self.get('/exams?q=khai pha',f.student).json()['meta']['total'],1)
        self.assertEqual(self.get('/exams?q=khai pha',f.waiting).json()['meta']['total'],1)

    def test_audit_search_role_time_and_count_share_the_same_predicates(self):
        f=self.fixture;now=datetime.now(timezone.utc)
        self.db.add_all([AuditLog(id=uuid4(),user_id=f.teacher.id,action='collection_test',created_at=now),
                         AuditLog(id=uuid4(),user_id=f.student.id,action='collection_test',created_at=now-timedelta(days=4))]);self.db.commit()
        response=self.get('/audit-logs?q=collection&role=teacher&page=1&limit=20',f.admin)
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertEqual(data['meta']['total'],1);self.assertEqual(data['data'][0]['user']['role'],'teacher')
        self.assertEqual(self.get('/audit-logs?q=collection',f.teacher).status_code,403)

    def test_card_search_is_collection_only_and_keeps_state_filter(self):
        response=self.get('/admin/student-cards?q=thien duc&status=NOT_SUBMITTED&page=3&limit=20',self.fixture.admin)
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertEqual(data['meta']['total'],45);self.assertEqual(len(data['data']),5)
        self.assertTrue(all(row['management_status']=='NOT_SUBMITTED' for row in data['data']))

    def test_audit_display_resolves_targets_without_changing_raw_history(self):
        from sqlalchemy import select
        from app.models.entities import Answer, SupportConversation
        f = self.fixture
        notice = Notification(id=uuid4(), recipient_user_id=f.student.id, type=NotificationType.student_card_notice,
                              title='Card notice', message='Example')
        conversation = SupportConversation(id=uuid4(), owner_id=f.student.id)
        self.db.add_all([notice, conversation]); self.db.flush()
        answer = self.db.scalar(select(Answer).where(Answer.attempt_id == f.submitted.id))
        raw = {'fields': ['phone'], 'reason': None, 'actor_name': 'Historical actor',
               'student_id': str(f.student.id), 'unknown': {'nested': [1, None, 'keep me']}}
        cases = [
            ('user', f.student.id, raw), ('student_card', f.student.id, raw),
            ('exam', f.exam.id, {'unknown': True}), ('attempt', f.submitted.id, ['legacy', None]),
            ('user', uuid4(), '{malformed'), ('unknown_entity', uuid4(), None),
            ('answer', answer.id, {}), ('notification', notice.id, {}), ('conversation', conversation.id, {}),
        ]
        logs = [AuditLog(id=uuid4(), user_id=f.admin.id, action='display_test', entity_type=kind,
                         entity_id=target, metadata_json=metadata) for kind, target, metadata in cases]
        self.db.add_all(logs); self.db.commit()
        response = self.get('/audit-logs?action=display_test&limit=100', f.admin)
        self.assertEqual(response.status_code, 200, response.text)
        data = {row['id']: row for row in response.json()['data']}
        for log in logs:
            row = data[str(log.id)]
            self.assertEqual(row['metadata'], log.metadata_json)
            self.assertEqual(row['user']['full_name'], f.admin.full_name)
            self.assertEqual(row['entity_id'], str(log.entity_id))
        for log in logs[:2]:
            self.assertEqual(data[str(log.id)]['target']['name'], f.student.full_name)
            self.assertEqual(data[str(log.id)]['target']['student_code'], f.student.student_code)
        self.assertEqual(data[str(logs[2].id)]['target']['name'], f.exam.title)
        self.assertEqual(data[str(logs[3].id)]['target']['name'], f.exam.title)
        self.assertIsNone(data[str(logs[4].id)]['target'])
        self.assertIsNone(data[str(logs[5].id)]['target'])
        self.assertEqual(data[str(logs[6].id)]['target']['name'], f.exam.title)
        self.assertEqual(data[str(logs[7].id)]['target']['name'], notice.title)
        self.assertEqual(data[str(logs[8].id)]['target']['name'], f.student.full_name)
        self.db.expire_all()
        for log, (_, _, original) in zip(logs, cases):
            self.assertEqual(self.db.get(AuditLog, log.id).metadata_json, original)
        self.assertEqual(self.get('/audit-logs?action=display_test', f.student).status_code, 403)

    def test_audit_target_resolution_batches_users_per_page(self):
        from sqlalchemy import event
        f = self.fixture
        self.db.add_all([AuditLog(id=uuid4(), user_id=f.admin.id, action='batch_display',
                                 entity_type='user', entity_id=student.id) for student in self.students])
        self.db.commit()
        statements = []
        def track(_connection, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)
        event.listen(self.db.get_bind(), 'before_cursor_execute', track)
        try:
            response = self.get('/audit-logs?action=batch_display&limit=20&page=2', f.admin)
        finally:
            event.remove(self.db.get_bind(), 'before_cursor_execute', track)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['meta']['total'], 45)
        self.assertEqual(len(response.json()['data']), 20)
        self.assertTrue(all(row['target']['name'] for row in response.json()['data']))
        # Auth, count, page, and one batched lookup, independent of the number of rows.
        self.assertLessEqual(len(statements), 5)

    def test_reports_sql_summary_is_whole_filter_not_current_page_and_csv_matches(self):
        f=self.fixture
        for student in self.students[:23]:f.attempt(student,fixtures.AttemptStatus.submitted,score=fixtures.Decimal('1'))
        self.db.commit()
        response=self.get(f'/teacher/reports?q=thien duc&exam_id={f.exam.id}&page=2&limit=20')
        self.assertEqual(response.status_code,200,response.text);data=response.json()['data']
        self.assertEqual(len(data['results']),3);self.assertEqual(data['meta']['total'],23)
        self.assertEqual(data['summary']['completed_attempts'],23)
        self.assertEqual(data['summary']['average_percentage'],50)
        roster=self.get(f'/exams/{f.exam.id}/report?q=thien duc&page=2&limit=20').json()['data']
        self.assertEqual(roster['statistics']['completed_attempts'],23)
        self.assertEqual(roster['statistics']['average_percentage'],50)
        with patch('app.api.v1.reports.SessionLocal',lambda:Session(self.db.get_bind())):
            response=self.get(f'/teacher/reports?q=thien duc&exam_id={f.exam.id}&format=csv')
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('text/csv',response.headers['content-type'])
        self.assertEqual(response.text.count('COL'),23)
        self.assertNotIn('REALCODE01',response.text)
        self.assertEqual(self.get(f'/teacher/reports?exam_id={f.exam.id}&format=csv',f.other).status_code,403)

    def test_notifications_read_state_type_and_recipient_filters(self):
        f=self.fixture
        for index in range(24):
            self.db.add(Notification(id=uuid4(),recipient_user_id=f.student.id,type=NotificationType.student_card_notice,
                title=f'Notice {index}',message='Synthetic collection test',is_read=index%2==0))
        self.db.add(Notification(id=uuid4(),recipient_user_id=f.active.id,type=NotificationType.student_card_notice,title='Other recipient',message='Private'))
        self.db.commit()
        data=self.get('/notifications?is_read=false&type=student_card_notice&page=1&limit=20',f.student).json()
        self.assertEqual(data['meta']['total'],12)
        self.assertTrue(all(not row['is_read'] and row['recipient_user_id']==str(f.student.id) for row in data['data']))

    def test_student_attempt_collection_search_date_and_owner(self):
        f=self.fixture;f.exam.title='Khai phá dữ liệu';self.db.commit()
        data=self.get('/attempts/mine?q=khai pha&completed_only=true&page=1&limit=20',f.student).json()
        self.assertEqual(data['meta']['total'],1)
        self.assertEqual(data['data'][0]['exam_title'],f.exam.title)
        self.assertEqual(data['data'][0]['student_id'],str(f.student.id))
        self.assertEqual(self.get('/attempts/mine?completed_only=true',f.waiting).json()['meta']['total'],0)
        self.assertEqual(self.get('/attempts/mine?completed_only=true').status_code,403)

    def test_event_collection_keeps_global_counts_filters_and_permissions(self):
        f=self.fixture;now=datetime.now(timezone.utc)
        for index in range(45):
            self.db.add(ViolationLog(id=uuid4(),attempt_id=f.submitted.id,type='tab_switch',severity=SeverityLevel.high if index%2 else SeverityLevel.low,occurred_at=now+timedelta(seconds=index)))
        self.db.commit()
        response=self.get(f'/reports/attempts/{f.submitted.id}?page=3&limit=20')
        self.assertEqual(response.status_code,200,response.text);data=response.json()['data']
        self.assertEqual(data['meta']['total'],45);self.assertEqual(len(data['events']),5)
        self.assertEqual(data['violation_count'],45)
        data=self.get(f'/reports/attempts/{f.submitted.id}?page=1&limit=20&severity=high&source=browser').json()['data']
        self.assertEqual(data['meta']['total'],22);self.assertEqual(data['violation_count'],45)
        self.assertTrue(all(row['severity']=='high' for row in data['events']))
        self.assertEqual(self.get(f'/reports/attempts/{f.submitted.id}?page=1',f.other).status_code,403)

    def test_related_audit_user_search_does_not_duplicate_rows(self):
        f=self.fixture
        self.db.add(AuditLog(id=uuid4(),user_id=f.admin.id,action='related_test',entity_type='user',entity_id=self.students[0].id,metadata_json={'student_id':str(self.students[1].id)}));self.db.commit()
        data=self.get('/audit-logs?q=COL000&page=1&limit=20',f.admin).json()
        self.assertEqual(data['meta']['total'],1)
        self.assertEqual(self.get('/audit-logs?q=related_test&page=1&limit=20',f.admin).json()['meta']['total'],1)

    def test_assignment_collection_pages_only_owned_exams(self):
        f=self.fixture;f.exam.title='Khai phá dữ liệu'
        for student in self.students:self.db.add(ExamAssignment(id=uuid4(),exam_id=f.exam.id,student_id=student.id))
        self.db.commit()
        response=self.get('/exam-assignments?q=khai pha&page=3&limit=20')
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertEqual(data['meta']['total'],48);self.assertEqual(len(data['data']),8)
        self.assertEqual(self.get('/exam-assignments?q=khai pha&page=1',f.other).json()['meta']['total'],0)
        self.assertEqual(self.get('/exam-assignments?q=khai pha&page=1',f.student).status_code,403)

    def test_calendar_date_window_and_live_filters_keep_class_access(self):
        f=self.fixture;now=datetime.now(timezone.utc)
        for index in range(25):self.db.add(LiveClass(id=uuid4(),class_id=f.cls.id,teacher_id=f.teacher.id,title=f'Buổi khai phá {index}',scheduled_start=now+timedelta(days=index),scheduled_end=now+timedelta(days=index,hours=1),status='scheduled' if index%2==0 else 'ended'))
        self.db.commit()
        query=f'/live-classes?q=khai pha&status=scheduled&class_id={f.cls.id}&page=1&limit=20'
        self.assertEqual(self.get(query).json()['meta']['total'],13)
        self.assertEqual(self.get(query,f.student).json()['meta']['total'],13)
        self.assertEqual(self.get(query,f.direct).json()['meta']['total'],0)
        self.assertEqual(self.get(query,f.other).json()['meta']['total'],0)
        before=(now-timedelta(days=1)).isoformat().replace('+00:00','Z');after=(now+timedelta(days=7)).isoformat().replace('+00:00','Z')
        self.assertEqual(self.get(query+f'&from_time={before}&to_time={after}').json()['meta']['total'],4)
        self.assertEqual(self.get('/exams?page=1&from_time=2099-01-01T00:00:00Z',f.student).json()['meta']['total'],0)
