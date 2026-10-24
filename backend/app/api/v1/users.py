from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Literal
from app.services.collections import search, ordered, page_query
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.core.security import hash_password
from app.models.entities import User, UserRole
from app.schemas.users import IdentityProfileVerify, UserAdminPublic, UserCreate, UserUpdate, PasswordReset
from app.services.audit import record_audit
from app.services.student_identity_profile import lock_user, profile_error, update_profile, validate_student_code, verify_profile
from app.services.profile_requests import complete_request, cancel_ineligible_request
from app.services.student_card_admin import invalidate_card
from app.services.profile_avatar import public_profile
router = APIRouter()
from typing import Optional


def _save(db: Session, user: User):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, 'diag', None), 'constraint_name', None)
        if constraint == 'uq_users_student_code' or 'UNIQUE constraint failed: users.student_code' in str(exc.orig):
            raise profile_error('STUDENT_CODE_EXISTS', 'Mã sinh viên đã được sử dụng.') from None
        raise
    db.refresh(user)
    return ok(public_profile(db, user, UserAdminPublic))
@router.get('')
def list_users(page:int=Query(1,ge=1), limit:int=Query(20,ge=1,le=100), role:Optional[UserRole]=None,
               q:str=Query('',max_length=255), is_active:bool|None=None,
               identity_profile_status:Literal['PENDING','VERIFIED']|None=None, sort:str='newest',
               db:Session=Depends(get_db), _:User=Depends(roles(UserRole.admin))):
    query=search(select(User),q,User.full_name,User.email,User.student_code)
    if role: query=query.where(User.role == role)
    if is_active is not None: query=query.where(User.is_active == is_active)
    if identity_profile_status: query=query.where(User.role == UserRole.student, User.identity_profile_status == identity_profile_status)
    query=ordered(query,sort,{'newest':User.created_at.desc(),'oldest':User.created_at.asc(),'name':func.lower(User.full_name).asc()},User.id)
    query,total=page_query(db,query,page,limit)
    rows=db.scalars(query).all()
    return ok([public_profile(db, row, UserAdminPublic) for row in rows],total=total,page=page,limit=limit)
@router.post('')
def create_user(payload:UserCreate, db:Session=Depends(get_db), _:User=Depends(roles(UserRole.admin))):
    if db.scalar(select(User).where(User.email==payload.email)): raise HTTPException(409,detail={'code':'EMAIL_EXISTS','message':'Email already exists','details':None})
    validate_student_code(db, payload.role, payload.student_code)
    user = User(id=uuid4(), full_name=payload.full_name, email=payload.email, password_hash=hash_password(payload.password), role=payload.role, phone=payload.phone, student_code=payload.student_code)
    db.add(user)
    record_audit(db, action='user_created', user_id=_.id, entity_type='user', entity_id=user.id, metadata={'role': user.role.value})
    return _save(db, user)
@router.get('/{user_id}')
def get_user(user_id: UUID, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    user = db.get(User, user_id)
    if not user:
        raise profile_error('NOT_FOUND', 'Không tìm thấy tài khoản.', 404)
    return ok(public_profile(db, user, UserAdminPublic))
@router.patch('/{user_id}')
def update_user(user_id:UUID,payload:UserUpdate,db:Session=Depends(get_db),_:User=Depends(roles(UserRole.admin))):
    user = lock_user(db, user_id)
    values = payload.model_dump(exclude_unset=True)
    card_changed = user.role == UserRole.student and user.student_card_status != 'NOT_SUBMITTED' and any(
        key in values and values[key] != getattr(user, key) for key in ('full_name', 'student_code', 'role', 'is_active'))
    update_profile(db, user, values)
    if card_changed:
        invalidate_card(db, user, _, 'Thông tin hồ sơ sinh viên đã được quản trị viên thay đổi. Vui lòng xác minh lại hồ sơ và tải thẻ mới.')
    cancel_ineligible_request(db, user)
    record_audit(db, action='user_updated', user_id=_.id, entity_type='user', entity_id=user.id, metadata={'fields': list(values), 'identity_profile_version': user.identity_profile_version})
    return _save(db, user)
@router.put('/{user_id}')
def replace_user(user_id:UUID,payload:UserUpdate,db:Session=Depends(get_db),admin:User=Depends(roles(UserRole.admin))):
    return update_user(user_id,payload,db,admin)


@router.post('/{user_id}/identity-profile/verify')
def verify_student_identity_profile(user_id: UUID, payload: IdentityProfileVerify, db: Session = Depends(get_db), admin: User = Depends(roles(UserRole.admin))):
    user = lock_user(db, user_id)
    if verify_profile(user, admin, payload.identity_profile_version):
        complete_request(db, user, admin)
        record_audit(db, action='student_identity_profile_verified', user_id=admin.id, entity_type='user', entity_id=user.id, metadata={'identity_profile_version': user.identity_profile_version})
    return _save(db, user)
@router.post('/{user_id}/reset-password')
def reset_password(user_id:UUID,payload:PasswordReset,db:Session=Depends(get_db),_:User=Depends(roles(UserRole.admin))):
    user=db.get(User,user_id)
    if not user: raise HTTPException(404,detail={'code':'NOT_FOUND','message':'User not found','details':None})
    user.password_hash=hash_password(payload.password); record_audit(db, action='user_password_reset', user_id=_.id, entity_type='user', entity_id=user.id); db.commit()
    return ok({'id':user.id,'message':'Password reset successfully'})
@router.delete('/{user_id}')
def deactivate_user(user_id:UUID,db:Session=Depends(get_db),_:User=Depends(roles(UserRole.admin))):
    user = lock_user(db, user_id)
    card_changed = user.role == UserRole.student and user.student_card_status != 'NOT_SUBMITTED' and user.is_active
    update_profile(db, user, {'is_active': False})
    if card_changed:
        invalidate_card(db, user, _, 'Tài khoản đã được ngừng hoạt động. Xác thực thẻ cũ không còn hiệu lực.')
    cancel_ineligible_request(db, user)
    record_audit(db, action='user_deactivated', user_id=_.id, entity_type='user', entity_id=user.id)
    return _save(db, user)
