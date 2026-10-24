from datetime import datetime, timedelta, timezone
from typing import Any
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)

def create_access_token(subject: str, role: str | None = None) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({'sub': subject, 'role': role, 'type': 'access', 'exp': expires}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def create_refresh_token(subject: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({'sub': subject, 'type': 'refresh', 'exp': expires}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError('Invalid or expired token') from exc

def decode_access_token(token: str) -> dict[str, Any]:
    payload = decode_token(token)
    if payload.get('type') != 'access' or not payload.get('sub'):
        raise ValueError('Invalid access token')
    return payload

def decode_refresh_token(token: str) -> dict[str, Any]:
    payload = decode_token(token)
    if payload.get('type') != 'refresh' or not payload.get('sub'):
        raise ValueError('Invalid refresh token')
    return payload
