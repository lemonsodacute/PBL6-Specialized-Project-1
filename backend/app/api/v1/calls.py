import asyncio
import http.cookies
from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.database import SessionLocal
from app.core.security import decode_access_token
from app.models.entities import AttemptStatus, Exam, ExamAttempt, User, UserRole

router = APIRouter()
ALLOWED_ROLES = {'teacher', 'student'}
ALLOWED_MESSAGE_TYPES = {'offer', 'answer', 'ice-candidate', 'call-end'}

class CallRoomManager:
    def __init__(self) -> None:
        self.rooms: dict[UUID, dict[str, WebSocket]] = defaultdict(dict)
        self.lock = asyncio.Lock()

    async def join(self, attempt_id: UUID, role: str, websocket: WebSocket) -> bool:
        async with self.lock:
            room = self.rooms[attempt_id]
            if role in room or len(room) >= 2:
                return False
            room[role] = websocket
            return True

    async def relay(self, attempt_id: UUID, sender_role: str, message: dict[str, Any]) -> None:
        async with self.lock:
            peer = self.rooms.get(attempt_id, {}).get('student' if sender_role == 'teacher' else 'teacher')
        if peer:
            try:
                await peer.send_json(message)
            except Exception:
                peer_role = 'student' if sender_role == 'teacher' else 'teacher'
                await self.leave(attempt_id, peer_role, peer)

    async def leave(self, attempt_id: UUID, role: str, websocket: WebSocket) -> WebSocket | None:
        async with self.lock:
            room = self.rooms.get(attempt_id)
            if not room or room.get(role) is not websocket:
                return None
            room.pop(role, None)
            peer = next(iter(room.values()), None)
            if not room:
                self.rooms.pop(attempt_id, None)
            return peer

call_rooms = CallRoomManager()

def _token_from_websocket(websocket: WebSocket) -> str | None:
    cookie = http.cookies.SimpleCookie()
    cookie.load(websocket.headers.get('cookie', ''))
    token = cookie.get('auth_token')
    if token:
        return token.value
    authorization = websocket.headers.get('authorization', '')
    return authorization[7:].strip() if authorization.lower().startswith('bearer ') else None

def _authenticated_user(websocket: WebSocket, db) -> User | None:
    token = _token_from_websocket(websocket)
    if not token:
        return None
    try:
        subject = decode_access_token(token).get('sub')
        user = db.get(User, UUID(subject))
        return user if user and user.is_active else None
    except Exception:
        return None

def _allowed(user: User | None, role: str, attempt: ExamAttempt | None, exam: Exam | None) -> bool:
    if not user or not attempt or not exam or role not in ALLOWED_ROLES:
        return False
    if role == 'student':
        return user.role == UserRole.student and attempt.student_id == user.id and attempt.status == AttemptStatus.in_progress
    return user.role in (UserRole.teacher, UserRole.admin) and (user.role == UserRole.admin or exam.created_by == user.id)

async def relay_call(websocket: WebSocket, attempt_id: UUID, role: str):
    db = SessionLocal()
    joined = False
    call_ended = False
    try:
        user = _authenticated_user(websocket, db)
        attempt = db.get(ExamAttempt, attempt_id)
        exam = db.get(Exam, attempt.exam_id) if attempt else None
        if not _allowed(user, role, attempt, exam):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        joined = await call_rooms.join(attempt_id, role, websocket)
        if not joined:
            await websocket.close(code=1008, reason='Call room is full')
            return
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict) or message.get('type') not in ALLOWED_MESSAGE_TYPES:
                await websocket.close(code=1003, reason='Unsupported signaling message')
                return
            if message.get('type') == 'call-end':
                call_ended = True
            await call_rooms.relay(attempt_id, role, message)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if joined:
            peer = await call_rooms.leave(attempt_id, role, websocket)
            if peer and not call_ended:
                try:
                    await peer.send_json({'type': 'call-end', 'reason': 'disconnected'})
                except Exception:
                    pass
        db.close()
