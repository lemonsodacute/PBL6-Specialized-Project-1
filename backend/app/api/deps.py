from collections.abc import Callable, Generator
from uuid import UUID
from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.entities import User, UserRole
from jose import JWTError

def _unauthorized(message: str = 'Authentication required') -> HTTPException:
    return HTTPException(status_code=401, detail={'code':'UNAUTHORIZED','message':message,'details':None})

def get_current_user(db: Session = Depends(get_db), auth_token: str | None = Cookie(default=None), authorization: str | None = Header(default=None)) -> User:
    token = auth_token
    # Explicit per-tab credentials take precedence. Never fall back to another
    # account's shared cookie when a supplied header is invalid or expired.
    if authorization is not None:
        if not authorization.lower().startswith('bearer '):
            raise _unauthorized('Invalid authentication header')
        token = authorization[7:].strip()
    if not token: raise _unauthorized()
    try: user_id = UUID(decode_access_token(token).get('sub'))
    except (JWTError, ValueError, TypeError, AttributeError) as exc: raise _unauthorized('Invalid or expired authentication token') from exc
    user = db.get(User, user_id)
    if not user or not user.is_active: raise _unauthorized('User is inactive or missing')
    return user

def require_role(*allowed: UserRole | str) -> Callable:
    allowed_values = {role.value if isinstance(role, UserRole) else role for role in allowed}
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role.value not in allowed_values: raise HTTPException(status_code=403, detail={'code':'FORBIDDEN','message':'Insufficient role','details':None})
        return user
    return dependency

current_user = get_current_user
roles = require_role
