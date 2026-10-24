from typing import Literal
from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, aliased
from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import AuditLog, StudentCardPreview, StudentCardReference, User, UserRole
from app.services import student_card_admin as cards
from app.services.student_card_identity import active_reference, preview_card_status
from app.services.student_card_previews import PRIVATE_HEADERS
from app.services.student_identity_profile import profile_error
from app.services.collections import search

router = APIRouter(prefix='/admin/student-cards')


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    identity_profile_version: int = Field(ge=1)
    card_admin_version: int = Field(ge=0)
    reference_id: UUID | None
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator('reference_id', mode='before')
    @classmethod
    def uuid_from_json(cls, value):
        return UUID(value) if isinstance(value, str) else value

    @field_validator('reason')
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Vui lòng nhập lý do.')
        return value


class NoticeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1, max_length=3000)

    @field_validator('title', 'message')
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Vui lòng nhập nội dung.')
        return value


def commit(db):
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise profile_error('CARD_ACTION_FAILED', 'Chưa lưu được thay đổi. Vui lòng thử lại.', 503) from None


@router.get('')
def list_cards(q: str = Query('', max_length=255), status: Literal['ALL', 'NOT_SUBMITTED', 'PENDING_CONFIRMATION', 'VERIFIED', 'NEEDS_REUPLOAD', 'REVOKED'] = 'ALL',
    page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    latest = select(StudentCardReference.id).where(StudentCardReference.student_id == User.id).order_by(
        StudentCardReference.created_at.desc(), StudentCardReference.id.desc()).limit(1).correlate(User).scalar_subquery()
    actor = aliased(User)
    pending = select(StudentCardPreview.id).where(StudentCardPreview.student_id == User.id,
        StudentCardPreview.status == 'PENDING', StudentCardPreview.expires_at > datetime.now(timezone.utc),
        StudentCardPreview.identity_profile_version == User.identity_profile_version,
        StudentCardPreview.card_admin_version == User.card_admin_version).correlate(User).exists()
    state = case(((User.student_card_status == 'NEEDS_REUPLOAD') & (User.card_last_action == 'CARD_REVOKED'), 'REVOKED'),
                 ((User.student_card_status == 'NOT_SUBMITTED') & pending, 'PENDING_CONFIRMATION'), else_=User.student_card_status)
    query = select(User, StudentCardReference, actor, state).outerjoin(StudentCardReference, StudentCardReference.id == latest).outerjoin(
        actor, actor.id == StudentCardReference.verified_by_user_id).where(User.role == UserRole.student)
    query=search(query,q,User.full_name,User.student_code,User.email)
    if status != 'ALL':
        query = query.where(state == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(User.full_name, User.id).offset((page - 1) * limit).limit(limit)).all()
    return ok([cards.serialize_student(user, ref, actor, effective_status=status) for user, ref, actor, status in rows], total=total, page=page, limit=limit)


def detail(db, student):
    ref = cards.latest_reference(db, student.id)
    actor = db.get(User, ref.verified_by_user_id) if ref and ref.verified_by_user_id else None
    result = cards.serialize_student(student, ref, actor, detail=True,
                                     effective_status='REVOKED' if cards.card_state(student) == 'REVOKED' else preview_card_status(db, student))
    current = active_reference(db, student)
    result.update(cards.avatar_fields(db, student, current))
    result['face_preview_url'] = f'/api/v1/admin/student-cards/{student.id}/references/{current.id}/face' if current and current.sanitized_face else None
    return result


@router.get('/{student_id}')
def get_card(student_id: UUID, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    return ok(detail(db, cards.managed_student(db, student_id)))


@router.get('/{student_id}/history')
def history(student_id: UUID, page: int = Query(1, ge=1), limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    cards.managed_student(db, student_id)
    query = cards.history_query(student_id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).offset((page-1)*limit).limit(limit)).all()
    return ok([cards.serialize_event(row) for row in rows], total=total, page=page, limit=limit)


@router.get('/{student_id}/references/{reference_id}/face')
def face_preview(student_id: UUID, reference_id: UUID, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    student = cards.managed_student(db, student_id)
    reference = active_reference(db, student)
    if not reference or reference.id != reference_id or not reference.sanitized_face:
        raise profile_error('NOT_FOUND', 'Ảnh định danh không còn khả dụng.', 404)
    return Response(reference.sanitized_face, media_type='image/jpeg', headers=PRIVATE_HEADERS)


def change_card(student_id, payload, db, admin, revoke):
    try:
        student = cards.managed_student(db, student_id)
        reference = cards.latest_reference(db, student_id)
        cards.check_snapshot(student, reference, payload)
        if revoke and not reference:
            raise profile_error('REFERENCE_REQUIRED', 'Sinh viên chưa có xác thực thẻ để thu hồi.', 409)
        if revoke and reference.revoked_at:
            raise profile_error('CARD_ALREADY_REVOKED', 'Xác thực thẻ này đã được thu hồi. Lịch sử thu hồi được giữ nguyên.', 409)
        cards.invalidate_card(db, student, admin, payload.reason, revoke=revoke)
        commit(db)
    except SQLAlchemyError:
        db.rollback()
        raise profile_error('CARD_ACTION_FAILED', 'Chưa lưu được thay đổi. Vui lòng thử lại.', 503) from None
    return ok(detail(db, student))


@router.post('/{student_id}/request-update')
def request_update(student_id: UUID, payload: ActionRequest, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    return change_card(student_id, payload, db, admin, False)


@router.post('/{student_id}/revoke')
def revoke_card(student_id: UUID, payload: ActionRequest, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    return change_card(student_id, payload, db, admin, True)


@router.post('/{student_id}/notifications')
def send_notice(student_id: UUID, payload: NoticeRequest, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    try:
        student = cards.managed_student(db, student_id)
        reference = cards.latest_reference(db, student_id)
        notification = cards.notify_card(db, student, admin, payload.title, payload.message, reference.id if reference else None)
        commit(db)
    except SQLAlchemyError:
        db.rollback()
        raise profile_error('CARD_ACTION_FAILED', 'Chưa gửi được thông báo. Vui lòng thử lại.', 503) from None
    return ok({'notification_id': str(notification.id), 'student_id': str(student.id)})
