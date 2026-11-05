from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from app.models.entities import Answer, AttemptStatus, Exam, ExamAssignment, ExamAttempt, ExamQuestion, ExamStatus, QuestionType
from tests import test_teacher_results as fixtures


class StudentExamStateTests(TestCase):
    def setUp(self):
        self.fixture=fixtures.TeacherResultsTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        f=self.fixture;self.db,self.client=f.db,f.client;self.student=f.student
        now=datetime.now(timezone.utc)
        self.exams=[Exam(id=uuid4(),title=f'Per exam {letter}',created_by=f.teacher.id,start_time=now-timedelta(hours=1),
                         end_time=now+timedelta(days=1),duration_minutes=60,max_attempts=3,status=ExamStatus.published,allow_review=False) for letter in 'ABC']
        self.db.add_all(self.exams);self.db.flush()
        for exam in self.exams:self.db.add(ExamAssignment(exam_id=exam.id,student_id=self.student.id))
        self.working=self.make_attempt(self.exams[1],self.student,AttemptStatus.in_progress,score=Decimal('3'))
        self.submitted=self.make_attempt(self.exams[2],self.student,AttemptStatus.submitted,score=Decimal('0'))
        self.foreign=self.make_attempt(self.exams[0],f.direct,AttemptStatus.submitted,score=Decimal('9'))
        self.db.commit()

    def make_attempt(self,exam,student,status,number=1,score=None):
        now=datetime.now(timezone.utc)
        attempt=ExamAttempt(id=uuid4(),exam_id=exam.id,student_id=student.id,status=status,attempt_number=number,
                            started_at=now,server_deadline_at=now+timedelta(hours=1),submitted_at=now if status!=AttemptStatus.in_progress else None,score=score,max_score=10)
        self.db.add(attempt);return attempt

    def get(self,path,actor=None):
        return self.client.get('/api/v1'+path,headers=self.fixture.headers(actor or self.student))

    def rows(self):
        result=self.get('/exams?q=Per%20exam&limit=100')
        self.assertEqual(result.status_code,200,result.text)
        return {row['id']:row for row in result.json()['data']}

    def test_a_none_b_working_c_submitted_are_scoped_to_both_keys(self):
        rows=self.rows();a,b,c=[rows[str(exam.id)] for exam in self.exams]
        self.assertIsNone(a['attempt']);self.assertEqual(a['attempts'],[])
        self.assertFalse(a['allow_review'])
        self.assertEqual(b['attempt']['status'],'in_progress');self.assertIsNone(b['attempt']['submitted_at'])
        self.assertEqual(Decimal(str(b['attempt']['score'])),Decimal('3'))
        self.assertEqual(c['attempt']['status'],'submitted');self.assertEqual(Decimal(str(c['attempt']['score'])),Decimal('0'))
        for row in (b,c):
            for item in [row['attempt'],*row['attempts']]:
                self.assertEqual(item['exam_id'],row['id']);self.assertEqual(item['student_id'],str(self.student.id))
                self.assertIn('server_deadline_at',item)
        self.assertNotIn(str(self.foreign.id),str(rows))

    def test_latest_attempt_is_per_exam_not_latest_for_student(self):
        first=self.working;first.status=AttemptStatus.submitted
        second=self.make_attempt(self.exams[1],self.student,AttemptStatus.in_progress,number=2,score=Decimal('7'))
        self.db.commit();rows=self.rows()
        self.assertEqual(rows[str(self.exams[1].id)]['attempt']['id'],str(second.id))
        self.assertEqual(rows[str(self.exams[1].id)]['attempt']['status'],'in_progress')
        self.assertIsNone(rows[str(self.exams[0].id)]['attempt'])
        self.assertEqual(rows[str(self.exams[2].id)]['attempt']['id'],str(self.submitted.id))

    def test_clone_with_identical_title_never_inherits_old_attempt(self):
        original=self.exams[2]
        clone=Exam(id=uuid4(),title=original.title,created_by=original.created_by,start_time=original.start_time,
                   end_time=original.end_time,duration_minutes=60,max_attempts=1,status=ExamStatus.published,allow_review=False)
        self.db.add(clone);self.db.flush();self.db.add(ExamAssignment(exam_id=clone.id,student_id=self.student.id));self.db.commit()
        rows=self.rows();self.assertIsNone(rows[str(clone.id)]['attempt']);self.assertEqual(rows[str(clone.id)]['attempts'],[])
        self.assertEqual(rows[str(original.id)]['attempt']['id'],str(self.submitted.id))

    def test_submit_b_changes_only_b_without_changing_a_or_c(self):
        before=self.rows()
        self.db.add(ExamQuestion(exam_id=self.exams[1].id,question_id=self.fixture.questions[0].id,points=1,order_index=0))
        self.db.add(Answer(attempt_id=self.working.id,question_id=self.fixture.questions[0].id,answer_content={'selected_option_id':'a'}));self.db.commit()
        with patch('app.api.v1.attempts.notify_teachers_of_exam'):
            response=self.client.post(f'/api/v1/attempts/{self.working.id}/submit',headers=self.fixture.headers(self.student))
        self.assertEqual(response.status_code,200,response.text);after=self.rows()
        self.assertEqual(after[str(self.exams[1].id)]['attempt']['status'],'submitted')
        self.assertEqual(after[str(self.exams[0].id)]['attempt'],before[str(self.exams[0].id)]['attempt'])
        self.assertEqual(after[str(self.exams[2].id)]['attempt'],before[str(self.exams[2].id)]['attempt'])

    def test_detail_and_list_have_same_owned_attempt(self):
        for exam in self.exams:
            listing=self.rows()[str(exam.id)];detail=self.get(f'/exams/{exam.id}').json()['data']
            self.assertEqual(detail['attempt'],listing['attempt']);self.assertEqual(detail['attempts'],listing['attempts'])

    def test_other_student_receives_their_own_attempt_only(self):
        # Assign the same A/B/C without reusing the first student's history.
        other=self.fixture.direct
        for exam in self.exams:self.db.add(ExamAssignment(exam_id=exam.id,student_id=other.id))
        self.db.commit();response=self.get('/exams?q=Per%20exam&limit=100',other)
        self.assertEqual(response.status_code,200,response.text)
        rows={row['id']:row for row in response.json()['data']}
        self.assertEqual(rows[str(self.exams[0].id)]['attempt']['id'],str(self.foreign.id))
        self.assertIsNone(rows[str(self.exams[1].id)]['attempt']);self.assertIsNone(rows[str(self.exams[2].id)]['attempt'])

    def test_auto_submitted_and_terminated_statuses_are_preserved(self):
        for status in (AttemptStatus.auto_submitted,AttemptStatus.terminated):
            self.submitted.status=status;self.db.commit()
            self.assertEqual(self.rows()[str(self.exams[2].id)]['attempt']['status'],status.value)

    def actionable(self, suffix=''):
        response=self.get('/exams?actionable_only=true&q=Per%20exam'+suffix)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def test_actionable_excludes_completed_and_ended_but_keeps_working_and_upcoming(self):
        now=datetime.now(timezone.utc)
        upcoming=Exam(id=uuid4(),title='Per exam D',created_by=self.fixture.teacher.id,
                      start_time=now+timedelta(days=1),end_time=now+timedelta(days=2),
                      duration_minutes=60,max_attempts=1,status=ExamStatus.published)
        ended=Exam(id=uuid4(),title='Per exam ended',created_by=self.fixture.teacher.id,
                   start_time=now-timedelta(days=2),end_time=now-timedelta(days=1),
                   duration_minutes=60,max_attempts=1,status=ExamStatus.closed)
        draft=Exam(id=uuid4(),title='Per exam draft',created_by=self.fixture.teacher.id,
                   start_time=now,end_time=now+timedelta(days=1),duration_minutes=60,max_attempts=1,status=ExamStatus.draft)
        self.db.add_all([upcoming,ended,draft]);self.db.flush()
        for exam in (upcoming,ended,draft):self.db.add(ExamAssignment(exam_id=exam.id,student_id=self.student.id))
        self.db.commit()
        # A completed exam with remaining capacity is still actionable.
        expected={str(self.exams[0].id),str(self.exams[1].id),str(self.exams[2].id),str(upcoming.id)}
        for status in (AttemptStatus.submitted,AttemptStatus.auto_submitted,AttemptStatus.terminated):
            self.submitted.status=status;self.db.commit()
            self.assertEqual({row['id'] for row in self.actionable()['data']},expected)

    def test_many_completed_exams_and_old_page_cannot_hide_actionable_exams(self):
        for index in range(105):
            exam=Exam(id=uuid4(),title=f'Per exam history {index}',created_by=self.fixture.teacher.id,
                      start_time=self.exams[0].start_time,end_time=self.exams[0].end_time,
                      duration_minutes=60,max_attempts=1,status=ExamStatus.published)
            self.db.add(exam);self.db.flush();self.db.add(ExamAssignment(exam_id=exam.id,student_id=self.student.id))
            self.make_attempt(exam,self.student,AttemptStatus.submitted,score=0)
        self.db.commit()
        data=self.actionable('&page=9&limit=1')
        self.assertEqual(data['meta']['total'],3)
        self.assertEqual({row['id'] for row in data['data']},{str(exam.id) for exam in self.exams})
        self.assertIsNone(data['meta']['page'])

    def test_all_actionable_exams_are_returned_even_over_page_limit(self):
        for index in range(22):
            exam=Exam(id=uuid4(),title=f'Per exam active {index}',created_by=self.fixture.teacher.id,
                      start_time=self.exams[0].start_time,end_time=self.exams[0].end_time,
                      duration_minutes=60,max_attempts=1,status=ExamStatus.published)
            self.db.add(exam);self.db.flush();self.db.add(ExamAssignment(exam_id=exam.id,student_id=self.student.id))
        self.db.commit();data=self.actionable('&limit=20')
        self.assertEqual(data['meta']['total'],25);self.assertEqual(len(data['data']),25)

    def test_expired_working_attempt_is_finalized_before_actionable_filter(self):
        self.working.server_deadline_at=datetime.now(timezone.utc)-timedelta(minutes=1);self.db.commit()
        self.assertEqual({row['id'] for row in self.actionable()['data']},{str(exam.id) for exam in self.exams})
        response=self.get('/attempts/mine?completed_only=true').json()
        row=next(item for item in response['data'] if item['id']==str(self.working.id))
        self.assertEqual(row['status'],'auto_submitted')

    def test_student_catalogue_keeps_completed_after_limit_or_exam_end(self):
        # Unlike actionable_only, include_completed lists earlier completed
        # results even if the student cannot currently retake the exam.
        self.exams[2].max_attempts = 1
        self.db.commit()
        response = self.actionable('&include_completed=true')
        rows = {row['id']: row for row in response['data']}
        completed = rows[str(self.exams[2].id)]
        self.assertEqual(completed['max_attempts'], 1)
        self.assertEqual(len(completed['attempts']), 1)
        self.assertEqual(completed['attempt']['status'], 'submitted')

        self.exams[2].end_time = datetime.now(timezone.utc) - timedelta(minutes=1)
        self.db.commit()
        self.assertNotIn(str(self.exams[2].id), {row['id'] for row in self.actionable()['data']})
        self.assertIn(str(self.exams[2].id), {row['id'] for row in self.actionable('&include_completed=true')['data']})

    def test_teacher_can_increase_attempts_and_extend_deadline_without_mutating_old_attempt(self):
        exam = self.exams[2]
        original = self.submitted.id
        teacher_headers = self.fixture.headers(self.fixture.teacher)
        changed = self.client.patch(
            f'/api/v1/exams/{exam.id}', headers=teacher_headers,
            json={'max_attempts': 4},
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()['data']['max_attempts'], 4)
        self.assertEqual(self.db.get(ExamAttempt, original).status, AttemptStatus.submitted)

        extended = exam.end_time + timedelta(days=1)
        result = self.client.patch(
            f'/api/v1/exams/{exam.id}', headers=teacher_headers,
            json={'end_time': extended.isoformat()},
        )
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(exam.end_time, extended)
        self.assertEqual(self.db.get(ExamAttempt, original).status, AttemptStatus.submitted)

        for payload, code in [
            ({'max_attempts': 2}, 422),
            ({'end_time': (extended-timedelta(days=2)).isoformat()}, 422),
            ({'title': 'Changed after submission'}, 409),
            ({'duration_minutes': 80}, 409),
        ]:
            response = self.client.patch(f'/api/v1/exams/{exam.id}', headers=teacher_headers, json=payload)
            self.assertEqual(response.status_code, code, response.text)

    def test_student_cannot_change_retakes_or_exam_window(self):
        result = self.client.patch(
            f'/api/v1/exams/{self.exams[2].id}',
            headers=self.fixture.headers(self.student),
            json={'max_attempts': 10},
        )
        self.assertIn(result.status_code, (401, 403))

    def test_results_only_completed_history_includes_working_and_start_date_filter(self):
        completed=self.get('/attempts/mine?completed_only=true').json()['data']
        self.assertIn(str(self.submitted.id),{row['id'] for row in completed})
        self.assertNotIn(str(self.working.id),{row['id'] for row in completed})
        start=datetime.now(timezone.utc)-timedelta(days=1)
        response=self.get(f'/attempts/mine?time_field=started&sort=started&from_time={start.isoformat().replace("+", "%2B")}')
        self.assertEqual(response.status_code,200,response.text)
        history={row['id']:row for row in response.json()['data']}
        self.assertIn(str(self.working.id),history)
        self.assertEqual(history[str(self.working.id)]['attempt_number'],1)
        self.assertIsNone(history[str(self.working.id)]['submitted_at'])
        self.assertNotIn(str(self.foreign.id),history)
        self.assertEqual(self.get('/attempts/mine?time_field=invalid').status_code,422)

    def test_pending_manual_grading_hides_partial_score_without_changing_stored_score(self):
        question=self.fixture.questions[0];question.type=QuestionType.essay
        self.db.add(ExamQuestion(exam_id=self.exams[2].id,question_id=question.id,points=5,order_index=0))
        answer=Answer(attempt_id=self.submitted.id,question_id=question.id,answer_content='Bài tự luận',points_awarded=None)
        self.db.add(answer);self.submitted.score=Decimal('3');self.db.commit()
        def representations():
            return [self.rows()[str(self.exams[2].id)]['attempt'],
                    next(row for row in self.get('/attempts/mine?completed_only=true').json()['data'] if row['id']==str(self.submitted.id)),
                    self.get(f'/attempts/{self.submitted.id}/result').json()['data']]
        for row in representations():
            self.assertTrue(row['grading_pending']);self.assertIsNone(row['final_score'])
            self.assertEqual(Decimal(str(row['score'])),Decimal('3'))
        self.assertEqual(self.submitted.score,Decimal('3'))
        answer.points_awarded=Decimal('0');self.submitted.score=Decimal('0');self.db.commit()
        for row in representations():
            self.assertFalse(row['grading_pending']);self.assertEqual(Decimal(str(row['final_score'])),Decimal('0'))

    def test_actionable_is_student_only_and_keeps_assignment_scope(self):
        self.assertEqual(self.get('/exams?actionable_only=true',self.fixture.teacher).status_code,403)
        response=self.get('/exams?actionable_only=true&q=Per%20exam',self.fixture.direct)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['data'],[])
