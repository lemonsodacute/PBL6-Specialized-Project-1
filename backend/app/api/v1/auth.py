import hashlib
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from threading import Lock
from uuid import UUID
from jose import JWTError

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, roles
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, decode_refresh_token, hash_password, verify_password
from app.models.entities import PasswordResetToken, User, UserRole
from app.schemas.auth import ForgotPasswordRequest, LoginRequest, RegisterRequest, ResetPasswordRequest, UserProfile, UserPublic
from app.services.audit import record_audit
from app.schemas.auth import SelfProfileUpdate
from app.services.student_identity_profile import lock_user
from app.services.profile_avatar import public_profile
from sqlalchemy.exc import SQLAlchemyError
import logging

router = APIRouter()
settings = get_settings()
_failed_logins: dict[str, list[datetime]] = defaultdict(list)
_failed_logins_lock = Lock()
_RATE_WINDOW = timedelta(minutes=5)
_RATE_LIMIT = 5
_RESET_TTL = timedelta(minutes=30)
logger = logging.getLogger('app.audit')

def _error(code: str, message: str, http_status: int = 401) -> HTTPException:
    return HTTPException(http_status, detail={'code': code, 'message': message, 'details': None})

def _client_key(request: Request, email: str) -> str:
    return f'{request.client.host if request.client else "unknown"}:{email.lower()}'

def _rate_limited(key: str) -> bool:
    now = datetime.now(timezone.utc)
    with _failed_logins_lock:
        _failed_logins[key] = [at for at in _failed_logins[key] if now - at < _RATE_WINDOW]
        return len(_failed_logins[key]) >= _RATE_LIMIT

def _record_failure(key: str) -> None:
    with _failed_logins_lock:
        _failed_logins[key].append(datetime.now(timezone.utc))

def _clear_failures(key: str) -> None:
    with _failed_logins_lock:
        _failed_logins.pop(key, None)

def _public_user(user: User) -> dict:
    return UserPublic.model_validate(user).model_dump(mode='json')

def _set_login(user: User, response: Response, db: Session) -> dict:
    access = create_access_token(str(user.id), user.role.value)
    _set_auth_cookies(response, access, create_refresh_token(str(user.id)))
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    # access_token được trả trong body để frontend có thể lưu vào sessionStorage,
    # cho phép nhiều tab đăng nhập bằng các tài khoản khác nhau trong cùng trình duyệt.
    # Cookie httpOnly vẫn được set để hỗ trợ luồng 1-tab thông thường không bị ảnh hưởng.
    return {'user': _public_user(user), 'access_token': access}

def _set_auth_cookies(response: Response, access: str, refresh: str | None = None) -> None:
    common = {'httponly': True, 'secure': settings.secure_cookies, 'samesite': 'lax', 'path': '/'}
    response.set_cookie('auth_token', access, max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60, **common)
    if refresh is not None:
        response.set_cookie('refresh_token', refresh, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400, **common)

@router.post('/login')
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    key = _client_key(request, payload.email)
    if _rate_limited(key):
        raise _error('RATE_LIMITED', 'Too many failed login attempts. Try again later.', 429)
    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        _record_failure(key)
        record_audit(db, action='login_failed', user_id=user.id if user else None, entity_type='user', entity_id=user.id if user else None, metadata={'email': payload.email.lower()}, ip_address=request.client.host if request.client else None)
        db.commit()
        logger.warning('login_failed', extra={'email': payload.email.lower(), 'client': request.client.host if request.client else 'unknown'})
        raise _error('INVALID_CREDENTIALS', 'Invalid email or password')
    # Check the password first so a failed login does not disclose account status.
    if not user.is_active:
        raise _error('ACCOUNT_DISABLED', 'Account cannot sign in', 403)
    _clear_failures(key)
    result = _set_login(user, response, db)
    record_audit(db, action='login_success', user_id=user.id, entity_type='user', entity_id=user.id, ip_address=request.client.host if request.client else None)
    db.commit()
    logger.info('login_success', extra={'user_id': str(user.id), 'role': user.role.value})
    return result

@router.post('/register')
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise _error('EMAIL_EXISTS', 'An account with this email already exists', 409)
    user = User(full_name=payload.full_name.strip(), email=email, password_hash=hash_password(payload.password), role=UserRole.student)
    db.add(user)
    db.commit()
    db.refresh(user)
    record_audit(db, action='user_registered', user_id=user.id, entity_type='user', entity_id=user.id)
    db.commit()
    logger.info('account_registered', extra={'user_id': str(user.id), 'role': user.role.value})
    return _set_login(user, response, db)

@router.post('/forgot-password')
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower(), User.is_active.is_(True)))
    result = {'message': 'If the email exists, password reset instructions have been created.'}
    if not user:
        return result
    raw_token = secrets.token_urlsafe(32)
    row = PasswordResetToken(user_id=user.id, token_hash=hashlib.sha256(raw_token.encode()).hexdigest(), expires_at=datetime.now(timezone.utc) + _RESET_TTL)
    db.add(row)
    record_audit(db, action='password_reset_requested', user_id=user.id, entity_type='user', entity_id=user.id)
    db.commit()
    # Development has no email provider; return the one-time token for local testing only.
    if settings.ENVIRONMENT.lower() not in {'production', 'prod'}:
        result['reset_token'] = raw_token
    logger.info('password_reset_requested', extra={'user_id': str(user.id)})
    return result

@router.post('/reset-password')
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    digest = hashlib.sha256(payload.token.encode()).hexdigest()
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == digest, PasswordResetToken.used_at.is_(None)).order_by(PasswordResetToken.created_at.desc()))
    now = datetime.now(timezone.utc)
    if not row or row.expires_at < now:
        raise _error('INVALID_RESET_TOKEN', 'Reset token is invalid or expired', 400)
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise _error('INVALID_RESET_TOKEN', 'Reset token is invalid or expired', 400)
    user.password_hash = hash_password(payload.password)
    row.used_at = now
    record_audit(db, action='password_reset_completed', user_id=user.id, entity_type='user', entity_id=user.id)
    db.commit()
    logger.info('password_reset_completed', extra={'user_id': str(user.id)})
    return {'message': 'Password has been reset successfully'}

@router.post('/refresh')
def refresh(response: Response, refresh_token: str | None = Cookie(default=None), db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    if not refresh_token:
        raise _error('UNAUTHORIZED', 'Refresh token required')
    try:
        user_id = UUID(decode_refresh_token(refresh_token)['sub'])
    except (JWTError, ValueError, TypeError, KeyError) as exc:
        raise _error('UNAUTHORIZED', 'Invalid or expired refresh token') from exc
    if authorization is not None:
        current = get_current_user(db=db, auth_token=None, authorization=authorization)
        if current.id != user_id:
            raise _error('SESSION_ACCOUNT_MISMATCH', 'Refresh cookie belongs to another account')
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise _error('UNAUTHORIZED', 'User is inactive or missing')
    access = create_access_token(str(user.id), user.role.value)
    _set_auth_cookies(response, access)
    # Trả access_token trong body để frontend có thể cập nhật sessionStorage.
    return {'user': UserPublic.model_validate(user).model_dump(mode='json'), 'access_token': access}

@router.post('/logout')
def logout(response: Response):
    response.delete_cookie('auth_token', path='/')
    response.delete_cookie('refresh_token', path='/')
    return {'logged_out': True}

@router.get('/me')
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {'user': public_profile(db, user, UserProfile)}


@router.patch('/me')
def update_phone(payload: SelfProfileUpdate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student, UserRole.teacher))):
    fields = payload.model_fields_set
    if not fields or (user.role == UserRole.student and fields != {'phone'}):
        raise _error('VALIDATION_ERROR', 'Thông tin cập nhật hồ sơ không hợp lệ.', 422)
    try:
        current = lock_user(db, user.id)
        if not current.is_active or current.role not in (UserRole.student, UserRole.teacher):
            raise _error('FORBIDDEN', 'Cần tài khoản sinh viên hoặc giảng viên đang hoạt động.', 403)
        if current.role == UserRole.student and fields != {'phone'}:
            raise _error('VALIDATION_ERROR', 'Thông tin cập nhật hồ sơ không hợp lệ.', 422)
        changed = []
        # Explicit assignments; no caller-controlled model attributes or owner ID.
        if 'full_name' in fields and current.role == UserRole.teacher and current.full_name != payload.full_name:
            current.full_name = payload.full_name
            changed.append('full_name')
        if 'phone' in fields and current.phone != payload.phone:
            current.phone = payload.phone
            changed.append('phone')
        if changed:
            record_audit(db, action='PROFILE_UPDATED' if current.role == UserRole.teacher else 'student_phone_updated', user_id=current.id, entity_type='user', entity_id=current.id, metadata={'fields': changed})
        db.commit()
        db.refresh(current)
    except SQLAlchemyError:
        db.rollback()
        raise _error('PROFILE_UPDATE_FAILED', 'Không thể cập nhật hồ sơ. Vui lòng thử lại.', 503) from None
    return {'user': public_profile(db, current, UserProfile)}
