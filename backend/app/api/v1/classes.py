from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import Class, ClassEnrollment, ExamAssignment, LiveClass, User, UserRole
from app.schemas.content import ClassCreate, ClassUpdate, EnrollmentCreate

from app.schemas.collections import CollectionParams
from app.services.collections import search, ordered, page_query

router = APIRouter()

def _not_found(message: str) -> HTTPException:
    return HTTPException(404, detail={'code': 'NOT_FOUND', 'message': message, 'details': None})

def _can_manage(cls: Class, user: User) -> bool:
    return user.role == UserRole.admin or cls.homeroom_teacher_id == user.id

def _already_enrolled() -> HTTPException:
    return HTTPException(409, detail={'code': 'STUDENT_ALREADY_ENROLLED', 'message': 'Sinh viên này đã thuộc lớp.', 'details': None})

def _serialize(db: Session, cls: Class, *, teacher=None, counts=None) -> dict:
    if counts is None:
        teacher = db.get(User, cls.homeroom_teacher_id) if cls.homeroom_teacher_id else None
    return {
        'id': cls.id, 'name': cls.name, 'description': cls.description,
        'homeroom_teacher_id': cls.homeroom_teacher_id,
        'teacher': None if not teacher else {'id': teacher.id, 'full_name': teacher.full_name, 'email': teacher.email},
        'students_count': counts[0] if counts is not None else db.scalar(select(func.count()).select_from(ClassEnrollment).where(ClassEnrollment.class_id == cls.id)) or 0,
        'exams_count': counts[1] if counts is not None else db.scalar(select(func.count()).select_from(ExamAssignment).where(ExamAssignment.class_id == cls.id)) or 0,
        'created_at': cls.created_at,
    }

def _serialize_live_class(item: LiveClass) -> dict:
    return {
        'id': item.id, 'class_id': item.class_id, 'teacher_id': item.teacher_id,
        'title': item.title, 'description': item.description,
        'scheduled_start': item.scheduled_start, 'scheduled_end': item.scheduled_end,
        'actual_start': item.actual_start, 'actual_end': item.actual_end,
        'meeting_url': item.meeting_url, 'recording_url': item.recording_url,
        'status': item.status, 'deleted_at': item.deleted_at,
        'created_at': item.created_at, 'updated_at': item.updated_at,
    }

@router.get('')
def list_classes(params: CollectionParams=Depends(), teacher_id: UUID|None=None, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher, UserRole.student))):
    query = search(select(Class),params.q,Class.name,Class.description)
    if teacher_id: query=query.where(Class.homeroom_teacher_id == teacher_id)
    if user.role == UserRole.teacher:
        query = query.where(Class.homeroom_teacher_id == user.id)
    elif user.role == UserRole.student:
        query = query.where(Class.id.in_(select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == user.id)))
    query=ordered(query,params.sort,{'newest':Class.created_at.desc(),'oldest':Class.created_at.asc(),'name':func.lower(Class.name).asc()},Class.id)
    query,total=page_query(db,query,params.page,params.limit)
    rows = db.scalars(query).all()
    ids = [cls.id for cls in rows]
    teachers = {teacher.id: teacher for teacher in db.scalars(select(User).where(User.id.in_(
        {cls.homeroom_teacher_id for cls in rows if cls.homeroom_teacher_id is not None}
    )))} if rows else {}
    members = dict(db.execute(select(ClassEnrollment.class_id, func.count()).where(ClassEnrollment.class_id.in_(ids)).group_by(ClassEnrollment.class_id)).all()) if rows else {}
    exams = dict(db.execute(select(ExamAssignment.class_id, func.count()).where(ExamAssignment.class_id.in_(ids)).group_by(ExamAssignment.class_id)).all()) if rows else {}
    return ok([_serialize(db, cls, teacher=teachers.get(cls.homeroom_teacher_id), counts=(members.get(cls.id, 0), exams.get(cls.id, 0))) for cls in rows],total=total,page=params.page,limit=params.limit)

@router.get('/{class_id}/live-classes')
def list_live_classes(class_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher, UserRole.student))):
    cls = db.get(Class, class_id)
    if not cls: raise _not_found('Class not found')
    if user.role == UserRole.student:
        allowed = db.scalar(select(ClassEnrollment.id).where(ClassEnrollment.class_id == class_id, ClassEnrollment.student_id == user.id))
    else:
        allowed = user.role == UserRole.admin or cls.homeroom_teacher_id == user.id
    if not allowed: raise _not_found('Class not found')
    rows = db.scalars(select(LiveClass).where(
        LiveClass.class_id == class_id,
        LiveClass.deleted_at.is_(None),
    ).order_by(LiveClass.scheduled_start)).all()
    return ok([_serialize_live_class(row) for row in rows])

@router.post('')
def create_class(payload: ClassCreate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    teacher_id = payload.homeroom_teacher_id or user.id
    teacher = db.get(User, teacher_id)
    if not teacher or teacher.role not in (UserRole.teacher, UserRole.admin):
        raise HTTPException(422, detail={'code': 'INVALID_TEACHER', 'message': 'homeroom_teacher_id must belong to a teacher or admin', 'details': None})
    if user.role != UserRole.admin and teacher_id != user.id:
        raise HTTPException(403, detail={'code': 'FORBIDDEN', 'message': 'Teacher can only create own classes', 'details': None})
    cls = Class(name=payload.name, description=payload.description, homeroom_teacher_id=teacher_id)
    db.add(cls); db.commit(); db.refresh(cls)
    return ok(_serialize(db, cls))

@router.get('/{class_id}')
def get_class(class_id: UUID, include_students:bool=True, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher, UserRole.student))):
    cls = db.get(Class, class_id)
    if not cls: raise _not_found('Class not found')
    if user.role == UserRole.student:
        enrolled = db.scalar(select(ClassEnrollment.id).where(
            ClassEnrollment.class_id == class_id,
            ClassEnrollment.student_id == user.id,
        ))
        if not enrolled: raise _not_found('Class not found')
        # Students receive only class metadata and the aggregate count.
        return ok(_serialize(db, cls))
    if not _can_manage(cls, user): raise _not_found('Class not found')
    students = db.execute(select(User.id, User.full_name, User.email).join(ClassEnrollment, ClassEnrollment.student_id == User.id).where(ClassEnrollment.class_id == cls.id)).all() if include_students else []
    return ok({**_serialize(db, cls), 'students': [dict(row._mapping) for row in students]})

@router.patch('/{class_id}')
def update_class(class_id: UUID, payload: ClassUpdate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    cls = db.get(Class, class_id)
    if not cls or not _can_manage(cls, user): raise _not_found('Class not found')
    values = payload.model_dump(exclude_unset=True)
    teacher_id = values.get('homeroom_teacher_id', cls.homeroom_teacher_id)
    if user.role != UserRole.admin and teacher_id != user.id:
        raise HTTPException(403, detail={'code': 'FORBIDDEN', 'message': 'Teacher can only manage own classes', 'details': None})
    for key, value in values.items(): setattr(cls, key, value)
    db.commit(); db.refresh(cls)
    return ok(_serialize(db, cls))

@router.delete('/{class_id}')
def delete_class(class_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    cls = db.get(Class, class_id)
    if not cls or not _can_manage(cls, user): raise _not_found('Class not found')
    db.delete(cls); db.commit()
    return ok({'deleted': True})

@router.get('/{class_id}/enrollments')
def list_enrollments(class_id: UUID, params: CollectionParams=Depends(), db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    cls = db.get(Class, class_id)
    if not cls or not _can_manage(cls, user): raise _not_found('Class not found')
    query=search(select(ClassEnrollment,User).join(User,User.id == ClassEnrollment.student_id).where(ClassEnrollment.class_id == class_id),params.q,User.full_name,User.email,User.student_code)
    query=ordered(query,params.sort,{'newest':ClassEnrollment.enrolled_at.desc(),'oldest':ClassEnrollment.enrolled_at.asc(),'name':func.lower(User.full_name).asc()},ClassEnrollment.id)
    query,total=page_query(db,query,params.page,params.limit)
    rows=db.execute(query).all()
    return ok([{'id': enrollment.id, 'class_id': enrollment.class_id, 'student_id': enrollment.student_id, 'enrolled_at':enrollment.enrolled_at, 'student': {'id': student.id, 'full_name': student.full_name, 'email': student.email,'student_code':student.student_code}} for enrollment, student in rows],total=total,page=params.page,limit=params.limit)

@router.get('/{class_id}/enrollments/available')
def list_available_students(class_id: UUID, params:CollectionParams=Depends(), db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    cls = db.get(Class, class_id)
    if not cls or not _can_manage(cls, user): raise _not_found('Class not found')
    enrolled = select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == class_id)
    query=search(select(User).where(User.role == UserRole.student, User.is_active.is_(True), User.id.not_in(enrolled)),params.q,User.full_name,User.email,User.student_code)
    query=ordered(query,params.sort,{'newest':User.created_at.desc(),'oldest':User.created_at.asc(),'name':func.lower(User.full_name).asc()},User.id)
    query,total=page_query(db,query,params.page,params.limit)
    rows=db.scalars(query).all()
    return ok([{'id': student.id, 'full_name': student.full_name, 'email': student.email,'student_code':student.student_code} for student in rows],total=total,page=params.page,limit=params.limit)

@router.post('/{class_id}/enrollments')
def enroll_student(class_id: UUID, payload: EnrollmentCreate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    cls = db.get(Class, class_id)
    student = db.get(User, payload.student_id)
    if not cls or not _can_manage(cls, user): raise _not_found('Class not found')
    if not student or student.role != UserRole.student: raise _not_found('Student not found')
    if db.scalar(select(ClassEnrollment.id).where(ClassEnrollment.class_id == class_id, ClassEnrollment.student_id == student.id)):
        raise _already_enrolled()
    enrollment = ClassEnrollment(class_id=class_id, student_id=student.id)
    # Another request can enroll this student between the check and commit.
    # The existing (class_id, student_id) unique constraint remains authoritative.
    try:
        db.add(enrollment); db.commit()
    except IntegrityError:
        db.rollback()
        if db.scalar(select(ClassEnrollment.id).where(ClassEnrollment.class_id == class_id, ClassEnrollment.student_id == payload.student_id)):
            raise _already_enrolled()
        raise
    db.refresh(enrollment)
    return ok(enrollment)

@router.delete('/{class_id}/enrollments/{student_id}')
def unenroll_student(class_id: UUID, student_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    cls = db.get(Class, class_id)
    if not cls or not _can_manage(cls, user): raise _not_found('Class not found')
    enrollment = db.scalar(select(ClassEnrollment).where(ClassEnrollment.class_id == class_id, ClassEnrollment.student_id == student_id))
    if not enrollment: raise _not_found('Enrollment not found')
    db.delete(enrollment); db.commit()
    return ok({'deleted': True})
