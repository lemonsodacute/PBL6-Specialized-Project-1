from datetime import datetime, timedelta, timezone
from unittest import TestCase
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import func, select

from app.models.entities import Answer, Exam, ExamAttempt, ExamQuestion, ExamStatus, Question, QuestionType
from app.schemas.question_documents import DraftConfiguration, DraftQuestion
from tests import test_teacher_results as fixtures


class RetiredOralTests(TestCase):
    def setUp(self):
        self.fixture = fixtures.TeacherResultsTests(); self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.db, self.client = self.fixture.db, self.fixture.client
        self.oral = Question(id=uuid4(), question_bank_id=self.fixture.bank.id, type=QuestionType.oral,
                             content='Legacy question', default_points=2, is_active=True, topic='Legacy topic')
        self.db.add(self.oral); self.db.commit()

    def request(self, method, path, body=None, actor=None):
        return self.client.request(method, '/api/v1'+path, headers=self.fixture.headers(actor), json=body)

    def test_oral_grading_routes_removed(self):
        for method, path, body in (('GET','/oral-grading',None), ('GET',f'/oral-grading/{uuid4()}',None),
                                   ('PATCH',f'/oral-grading/{uuid4()}',{'score':1})):
            self.assertEqual(self.request(method,path,body).status_code,404)

    def test_question_authoring_accepts_supported_formats_rejects_oral(self):
        path=f'/question-banks/{self.fixture.bank.id}/questions'
        for kind in ('mcq_single','mcq_multi','essay'):
            response=self.request('POST',path,{'question_bank_id':str(self.fixture.bank.id),'type':kind,'content':kind})
            self.assertEqual(response.status_code,200,response.text)
        result=self.request('POST',path,{'question_bank_id':str(self.fixture.bank.id),'type':'oral','content':'Do not create'})
        self.assertEqual(result.status_code,422)
        self.assertEqual(self.request('PATCH',f'/question-banks/questions/{self.fixture.questions[0].id}',{'type':'oral'}).status_code,422)
        self.assertEqual(self.request('PATCH',f'/question-banks/questions/{self.oral.id}',{'content':'Do not edit oral'}).status_code,422)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Question).where(Question.type==QuestionType.oral)),1)

    def test_bank_counts_topics_and_random_selection_exclude_legacy(self):
        f=self.fixture
        response=self.request('GET',f'/question-banks/{f.bank.id}/questions')
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertEqual(data['meta']['total'],2)
        self.assertNotIn('Legacy topic',data['meta']['topics'])
        self.assertTrue(all(row['type']!='oral' for row in data['data']))
        bank=self.request('GET',f'/question-banks/{f.bank.id}').json()['data']
        self.assertEqual(bank['questions_count'],2)
        result=self.request('POST',f'/question-banks/{f.bank.id}/random-select',{'count':2})
        self.assertEqual(result.status_code,200,result.text)
        self.assertTrue(all(row['type']!='oral' for row in result.json()['data']))
        self.assertEqual(self.request('POST',f'/question-banks/{f.bank.id}/random-select',{'count':1,'question_type':'oral'}).status_code,422)
        self.assertEqual(self.request('GET',f'/question-banks/{f.bank.id}/questions?type=oral').status_code,422)

    def test_manual_bulk_and_random_exam_linking_cannot_include_oral(self):
        f=self.fixture;f.exam.status=ExamStatus.draft
        draft=Exam(id=uuid4(),title='New draft',created_by=f.teacher.id,start_time=datetime.now(timezone.utc),
                   end_time=datetime.now(timezone.utc)+timedelta(hours=1),duration_minutes=60,status=ExamStatus.draft)
        self.db.add(draft);self.db.commit()
        manual=self.request('POST',f'/exams/{draft.id}/questions',{'question_id':str(self.oral.id)})
        bulk=self.request('PUT',f'/exams/{draft.id}/questions',{'question_ids':[str(self.oral.id)]})
        for response in (manual,bulk):
            self.assertEqual(response.status_code,422,response.text)
            self.assertEqual(response.json()['error']['code'],'ORAL_EXAMS_DISABLED')
        random=self.request('POST',f'/exams/{draft.id}/questions/random',{'question_bank_id':str(f.bank.id),'count':3})
        self.assertEqual(random.status_code,400,random.text)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ExamQuestion).where(ExamQuestion.exam_id==draft.id)),0)
        random=self.request('POST',f'/exams/{draft.id}/questions/random',{'question_bank_id':str(f.bank.id),'count':2})
        self.assertEqual(random.status_code,200,random.text)
        self.assertNotIn(str(self.oral.id),{row['question_id'] for row in random.json()['data']})

    def test_publish_legacy_exam_is_blocked_before_status_change(self):
        f=self.fixture
        draft=Exam(id=uuid4(),title='Legacy draft',created_by=f.teacher.id,start_time=datetime.now(timezone.utc),
                   end_time=datetime.now(timezone.utc)+timedelta(hours=1),duration_minutes=60,status=ExamStatus.draft)
        self.db.add(draft);self.db.flush();self.db.add(ExamQuestion(exam_id=draft.id,question_id=self.oral.id,points=1,order_index=0));self.db.commit()
        response=self.request('PATCH',f'/exams/{draft.id}',{'status':'published'})
        self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(self.db.get(Exam,draft.id).status,ExamStatus.draft)
        response=self.request('PUT',f'/exams/{draft.id}/questions',{'question_ids':[str(f.questions[0].id)]})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.request('PATCH',f'/exams/{draft.id}',{'status':'published'}).status_code,200)

    def add_legacy_link(self):
        self.db.add(ExamQuestion(exam_id=self.fixture.exam.id,question_id=self.oral.id,points=2,order_index=2));self.db.commit()

    def test_student_cannot_start_or_resume_legacy_but_history_remains(self):
        f=self.fixture;self.add_legacy_link()
        result=self.request('POST','/attempts',{'exam_id':str(f.exam.id)},f.waiting)
        self.assertEqual(result.status_code,422,result.text)
        self.assertEqual(result.json()['error']['code'],'ORAL_EXAMS_DISABLED')
        self.assertEqual(self.request('GET',f'/attempts/{f.progress.id}',actor=f.active).status_code,422)
        self.assertEqual(self.request('GET',f'/attempts/{f.progress.id}/questions',actor=f.active).status_code,422)
        self.assertEqual(self.request('GET','/exams',actor=f.student).json()['meta']['total'],0)
        self.assertEqual(self.request('GET',f'/attempts/{f.submitted.id}/result',actor=f.student).status_code,200)
        self.assertEqual(self.db.get(ExamAttempt,f.submitted.id).score,f.submitted.score)
        self.assertEqual(self.request('GET',f'/exams/{f.exam.id}').status_code,200)

    def test_legacy_answers_cannot_be_saved_or_manually_graded(self):
        f=self.fixture;self.add_legacy_link()
        saved=self.request('PUT',f'/attempts/{f.progress.id}/answers',{'question_id':str(self.oral.id),'answer_content':'No oral answer'},f.active)
        self.assertEqual(saved.status_code,422,saved.text)
        answer=Answer(id=uuid4(),attempt_id=f.submitted.id,question_id=self.oral.id,answer_content='Historical answer')
        self.db.add(answer);self.db.commit()
        response=self.request('PATCH',f'/answers/{answer.id}/grade',{'points_awarded':1})
        self.assertEqual(response.status_code,422,response.text)
        self.assertIsNone(self.db.get(Answer,answer.id).points_awarded)

    def test_document_generation_and_import_schemas_do_not_accept_oral(self):
        with self.assertRaises(ValidationError): DraftConfiguration(mode='generate',question_type='oral')
        with self.assertRaises(ValidationError): DraftQuestion(id=uuid4(),content='No oral draft',type='oral',answers=['Sample'])
