"""Small deterministic demo dataset. Run from backend: python scripts/seed_data.py"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.entities import (User, UserRole, Class, ClassEnrollment, ExamAssignment, QuestionBank, Question,
    QuestionType, QuestionDifficulty, Exam, ExamStatus, ExamQuestion, LiveClass, LiveClassStatus)

def ensure_live_classes(db, cls, teacher):
    if db.scalar(select(LiveClass.id).where(LiveClass.class_id == cls.id)):
        return
    now = datetime.now(timezone.utc)
    db.add_all([
        LiveClass(class_id=cls.id, teacher_id=teacher.id, title='Workshop: Xây dựng form đăng nhập',
                  description='Thực hành form và validation với HTML/CSS.',
                  scheduled_start=now + timedelta(days=1, hours=2), scheduled_end=now + timedelta(days=1, hours=3, minutes=30),
                  meeting_url='https://meet.example.test/pbl6-web-form', status=LiveClassStatus.scheduled),
        LiveClass(class_id=cls.id, teacher_id=teacher.id, title='Ôn tập Web API trước kỳ thi',
                  description='Giải đáp câu hỏi và thực hành gọi API từ frontend.',
                  scheduled_start=now + timedelta(days=3), scheduled_end=now + timedelta(days=3, hours=2),
                  meeting_url='https://meet.example.test/pbl6-web-api', status=LiveClassStatus.scheduled),
    ])

def run():
    db=SessionLocal()
    try:
        if db.scalar(select(User).where(User.email=='admin@example.com')):
            cls = db.scalar(select(Class).where(Class.name == 'AI Proctoring Demo Class'))
            teacher = db.scalar(select(User).where(User.email == 'teacher1@example.com'))
            exams = db.scalars(select(Exam).where(Exam.title.in_(['Demo Exam 1', 'Demo Exam 2']))).all()
            if cls and teacher:
                ensure_live_classes(db, cls, teacher)
                for exam in exams:
                    if not db.scalar(select(ExamAssignment.id).where(ExamAssignment.exam_id == exam.id, ExamAssignment.class_id == cls.id)):
                        db.add(ExamAssignment(exam_id=exam.id, class_id=cls.id))
                db.commit()
            print('Seed already exists; assignments checked.'); return
        dev_password = 'Password123!'
        admin=User(full_name='System Admin',email='admin@example.com',password_hash=hash_password(dev_password),role=UserRole.admin)
        teachers=[User(full_name=f'Teacher {i}',email=f'teacher{i}@example.com',password_hash=hash_password(dev_password),role=UserRole.teacher) for i in (1,2)]
        students=[User(full_name=f'Student {i}',email=f'student{i}@example.com',password_hash=hash_password(dev_password),role=UserRole.student) for i in range(1,9)]
        db.add_all([admin,*teachers,*students]); db.flush()
        cls=Class(name='AI Proctoring Demo Class',description='Seed class',homeroom_teacher_id=teachers[0].id); db.add(cls); db.flush()
        db.add_all([ClassEnrollment(class_id=cls.id,student_id=s.id) for s in students])
        bank=QuestionBank(name='Demo Question Bank',description='Four question types',subject='Computer Science',created_by=teachers[0].id); db.add(bank); db.flush()
        definitions=[]
        for i in range(1,7): definitions.append(Question(question_bank_id=bank.id,type=QuestionType.mcq_single,content=f'MCQ single question {i}',options_json={'options':['A','B','C','D']},correct_answer_json={'answer':'A'},difficulty=QuestionDifficulty.easy))
        for i in range(7,10): definitions.append(Question(question_bank_id=bank.id,type=QuestionType.mcq_multi,content=f'MCQ multi question {i}',options_json={'options':['A','B','C','D']},correct_answer_json={'answers':['A','B']},difficulty=QuestionDifficulty.medium))
        for i in range(10,14): definitions.append(Question(question_bank_id=bank.id,type=QuestionType.essay,content=f'Essay question {i}',difficulty=QuestionDifficulty.medium))
        for i in range(14,16): definitions.append(Question(question_bank_id=bank.id,type=QuestionType.oral,content=f'Oral question {i}',difficulty=QuestionDifficulty.hard,oral_prep_seconds=30,oral_answer_seconds=120))
        db.add_all(definitions); db.flush()
        now=datetime.now(timezone.utc)
        exams=[]
        for i in (1,2):
            exam=Exam(title=f'Demo Exam {i}',description='Seed exam',created_by=teachers[0].id,start_time=now,end_time=now+timedelta(days=30),duration_minutes=60,status=ExamStatus.published,allow_review=False,require_camera=True,require_mic=True); db.add(exam); db.flush(); exams.append(exam)
            db.add_all([ExamQuestion(exam_id=exam.id,question_id=q.id,order_index=n,points=Decimal('1.00')) for n,q in enumerate(definitions[:10])])
            db.add(ExamAssignment(exam_id=exam.id, class_id=cls.id))
        ensure_live_classes(db, cls, teachers[0])
        db.commit(); print('Seed complete: 1 admin, 2 teachers, 8 students, 1 class, 15 questions, 2 exams.')
    finally: db.close()
if __name__=='__main__': run()
