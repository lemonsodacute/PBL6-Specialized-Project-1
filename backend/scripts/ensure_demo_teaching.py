"""Prepare a small real teacher/student dataset for local testing."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select

from app.core.database import SessionLocal
from app.models.entities import Class, ClassEnrollment, Exam, ExamAssignment, User, UserRole


def run() -> None:
    db = SessionLocal()
    try:
        teachers = {u.email: u for u in db.scalars(select(User).where(User.role == UserRole.teacher)).all()}
        students = {u.email: u for u in db.scalars(select(User).where(User.role == UserRole.student)).all()}
        teacher1 = teachers.get('teacher1@example.com')
        teacher2 = teachers.get('teacher2@example.com')
        if not teacher1 or not teacher2 or len(students) < 8:
            raise RuntimeError('Run scripts/seed_data.py first.')

        class1 = db.scalar(select(Class).where(Class.name == 'Lập trình Web - Nhóm 1'))
        if not class1:
            class1 = Class(name='Lập trình Web - Nhóm 1', description='Lớp demo của Teacher 1', homeroom_teacher_id=teacher1.id)
            db.add(class1)
            db.flush()
        else:
            class1.homeroom_teacher_id = teacher1.id

        class2 = db.scalar(select(Class).where(Class.name == 'Cơ sở dữ liệu - Nhóm 2'))
        if not class2:
            class2 = Class(name='Cơ sở dữ liệu - Nhóm 2', description='Lớp demo của Teacher 2', homeroom_teacher_id=teacher2.id)
            db.add(class2)
            db.flush()
        else:
            class2.homeroom_teacher_id = teacher2.id

        assignments = {
            class1.id: [students[f'student{i}@example.com'] for i in range(1, 5)],
            class2.id: [students[f'student{i}@example.com'] for i in range(5, 9)],
        }
        for class_id, class_students in assignments.items():
            db.execute(delete(ClassEnrollment).where(ClassEnrollment.class_id == class_id))
            db.add_all([ClassEnrollment(class_id=class_id, student_id=student.id) for student in class_students])

        exam1 = db.scalar(select(Exam).where(Exam.title == 'Demo Exam 1'))
        exam2 = db.scalar(select(Exam).where(Exam.title == 'Demo Exam 2'))
        if not exam1 or not exam2:
            raise RuntimeError('Demo exams are missing. Run scripts/seed_data.py first.')
        exam1.created_by = teacher1.id
        exam2.created_by = teacher2.id
        exam1.allow_review = exam2.allow_review = False
        exam1.require_camera = exam2.require_camera = True
        exam1.require_mic = exam2.require_mic = True

        db.execute(delete(ExamAssignment).where(ExamAssignment.exam_id.in_([exam1.id, exam2.id])))
        db.add(ExamAssignment(exam_id=exam1.id, class_id=class1.id))
        db.add(ExamAssignment(exam_id=exam2.id, class_id=class2.id))
        db.commit()
        print('Teacher demo data ready: teacher1 -> students 1-4 / Demo Exam 1; teacher2 -> students 5-8 / Demo Exam 2')
    finally:
        db.close()


if __name__ == '__main__':
    run()
