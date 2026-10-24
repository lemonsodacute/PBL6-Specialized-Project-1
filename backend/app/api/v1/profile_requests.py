from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import ProfileVerificationRequest, User, UserRole
from app.schemas.users import UserAdminPublic
from app.schemas.profile_requests import EmptyRequest, RejectProfileRequest
from app.services import profile_requests as service
from app.services.student_identity_profile import profile_error

router = APIRouter()


@router.get('/identity/profile-verification/status')
def status(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    return ok(service.student_status(db, user))


@router.post('/identity/profile-verification/request')
def request_verification(payload: EmptyRequest = Body(default=EmptyRequest()), db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    try:
        current = service.request_verification(db, user.id)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise profile_error('REQUEST_SAVE_FAILED', 'Chưa gửi được yêu cầu. Vui lòng thử lại.', 503) from None
    return ok(service.student_status(db, current))


@router.get('/users/profile-verification/requests')
def list_requests(status: Literal['PENDING', 'REJECTED', 'COMPLETED', 'CANCELLED'] | None = 'PENDING',
                  student_id: UUID | None = None, page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                  db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    query = select(ProfileVerificationRequest, User).join(User, User.id == ProfileVerificationRequest.student_id)
    if status:
        query = query.where(ProfileVerificationRequest.status == status)
    if student_id:
        query = query.where(User.id == student_id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(ProfileVerificationRequest.requested_at, ProfileVerificationRequest.id).offset((page-1)*limit).limit(limit)).all()
    return ok([{'id': row.id, 'status': row.status, 'requested_at': row.requested_at,
                'reviewed_at': row.reviewed_at, 'rejection_reason': row.rejection_reason,
                'student': UserAdminPublic.model_validate(student).model_dump()} for row, student in rows], total=total, page=page, limit=limit)


@router.post('/users/profile-verification/requests/{request_id}/reject')
def reject(request_id: UUID, payload: RejectProfileRequest, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    try:
        row = service.reject_request(db, request_id, admin, payload.identity_profile_version, payload.rejection_reason)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise profile_error('REQUEST_SAVE_FAILED', 'Chưa lưu được kết quả. Vui lòng thử lại.', 503) from None
    return ok({'id': row.id, 'status': row.status, 'reviewed_at': row.reviewed_at})
