from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import Class, Exam, ExamAssignment, User, UserRole
from app.schemas.content import AssignmentCreate
from app.schemas.collections import CollectionParams
from app.services.collections import search,ordered,page_query

router = APIRouter()

def _not_found(message: str) -> HTTPException:
    return HTTPException(404, detail={'code': 'NOT_FOUND', 'message': message, 'details': None})

def _can_manage(exam: Exam, user: User) -> bool:
    return user.role == UserRole.admin or exam.created_by == user.id

def _serialize(db: Session, assignment: ExamAssignment) -> dict:
    cls = db.get(Class, assignment.class_id) if assignment.class_id else None
    exam = db.get(Exam, assignment.exam_id)
    student = db.get(User, assignment.student_id) if assignment.student_id else None
    return {
        'id': assignment.id, 'exam_id': assignment.exam_id, 'class_id': assignment.class_id,
        'student_id': assignment.student_id, 'assigned_at': assignment.assigned_at,
        'class': None if not cls else {'id': cls.id, 'name': cls.name},
        'exam': None if not exam else {'id': exam.id, 'title': exam.title, 'status': exam.status, 'start_time': exam.start_time, 'end_time': exam.end_time},
        'student': None if not student else {'id': student.id, 'full_name': student.full_name, 'email': student.email},
    }

@router.get('')
def list_assignments(
    exam_id: UUID | None = Query(default=None),
    class_id: UUID | None = Query(default=None),
    params:CollectionParams=Depends(),
    db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher)),
):
    query = select(ExamAssignment).join(Exam,Exam.id==ExamAssignment.exam_id)
    if user.role!=UserRole.admin:query=query.where(Exam.created_by==user.id)
    if exam_id is not None:
        query = query.where(ExamAssignment.exam_id == exam_id)
    if class_id is not None:
        query = query.where(ExamAssignment.class_id == class_id)
    query=search(query,params.q,Exam.title,Exam.description)
    query=ordered(query,params.sort,{'newest':ExamAssignment.assigned_at.desc(),'oldest':ExamAssignment.assigned_at.asc(),'name':Exam.title.asc()},ExamAssignment.id)
    query,total=page_query(db,query,params.page,params.limit)
    return ok([_serialize(db,item) for item in db.scalars(query)],total=total,page=params.page,limit=params.limit)

@router.post('')
def create_assignment(payload: AssignmentCreate, exam_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    if (payload.class_id is None) == (payload.student_id is None):
        raise HTTPException(422, detail={'code': 'INVALID_TARGET', 'message': 'Exactly one of class_id or student_id is required', 'details': None})
    exam = db.get(Exam, exam_id)
    if not exam or not _can_manage(exam, user): raise _not_found('Exam not found')
    if payload.class_id is not None:
        target_class = db.get(Class, payload.class_id)
        if not target_class or (user.role != UserRole.admin and target_class.homeroom_teacher_id != user.id):
            raise _not_found('Class not found')
    if payload.student_id is not None:
        student = db.get(User, payload.student_id)
        if not student or student.role != UserRole.student: raise _not_found('Student not found')
    duplicate = db.scalar(select(ExamAssignment.id).where(
        ExamAssignment.exam_id == exam_id,
        ExamAssignment.class_id == payload.class_id,
        ExamAssignment.student_id == payload.student_id,
    ))
    if duplicate:
        raise HTTPException(409, detail={'code': 'ALREADY_ASSIGNED', 'message': 'This target is already assigned to the exam', 'details': None})
    assignment = ExamAssignment(exam_id=exam_id, **payload.model_dump())
    db.add(assignment); db.commit(); db.refresh(assignment)
    return ok(_serialize(db, assignment))

@router.delete('/{assignment_id}')
def delete_assignment(assignment_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    assignment = db.get(ExamAssignment, assignment_id)
    if not assignment: raise _not_found('Assignment not found')
    exam = db.get(Exam, assignment.exam_id)
    if not exam or not _can_manage(exam, user): raise _not_found('Assignment not found')
    db.delete(assignment); db.commit()
    return ok({'deleted': True})
