from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, WebSocket
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import AttemptStatus, Exam, ExamAttempt, ProctoringSession, User, UserRole
from app.services.attempts import finalize_expired_attempt

# Preserve the existing recording feature; media routes enforce private access.
RECORDING_DIR = Path(__file__).resolve().parents[3] / 'uploads' / 'recordings'
MAX_RECORDING_BYTES = 500 * 1024 * 1024

router = APIRouter()


def _attempt_access(attempt: ExamAttempt | None, user: User, db: Session) -> tuple[ExamAttempt, Exam]:
    exam = db.get(Exam, attempt.exam_id) if attempt else None
    if not attempt or not exam:
        from fastapi import HTTPException
        raise HTTPException(404, detail={'code': 'NOT_FOUND', 'message': 'Attempt not found', 'details': None})
    if user.role == UserRole.student and attempt.student_id != user.id:
        from fastapi import HTTPException
        raise HTTPException(403, detail={'code': 'FORBIDDEN', 'message': 'You cannot access this attempt', 'details': None})
    if user.role == UserRole.teacher and exam.created_by != user.id:
        from fastapi import HTTPException
        raise HTTPException(403, detail={'code': 'FORBIDDEN', 'message': 'You cannot access this attempt', 'details': None})
    return attempt, exam


@router.post('/sessions/{attempt_id}')
def start_session(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role != UserRole.student:
        raise HTTPException(403, detail={'code': 'FORBIDDEN', 'message': 'Only the student can start proctoring', 'details': None})
    attempt, _ = _attempt_access(db.get(ExamAttempt, attempt_id), user, db)
    if finalize_expired_attempt(db, attempt):
        db.commit()
    session = db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt.id))
    if session:
        if attempt.status == AttemptStatus.in_progress:
            session.camera_enabled = True
            session.mic_enabled = True
            db.commit()
        return ok(session)
    now = datetime.now(timezone.utc)
    session = ProctoringSession(attempt_id=attempt.id, started_at=now, camera_enabled=True, mic_enabled=True)
    db.add(session)
    db.commit()
    db.refresh(session)
    return ok(session)


@router.get('/sessions/{attempt_id}')
def get_session(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt, _ = _attempt_access(db.get(ExamAttempt, attempt_id), user, db)
    if finalize_expired_attempt(db, attempt):
        db.commit()
    return ok(db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt.id)))


@router.post('/sessions/{attempt_id}/recording')
async def upload_recording(
    attempt_id: UUID,
    recording: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if recording.content_type not in {'video/webm', 'video/mp4', 'application/octet-stream'}:
        raise HTTPException(415, detail={'code': 'INVALID_RECORDING_TYPE', 'message': 'Only WebM or MP4 recordings are allowed', 'details': None})
    if user.role != UserRole.student:
        raise HTTPException(403, detail={'code': 'FORBIDDEN', 'message': 'Only the student can upload this recording', 'details': None})
    attempt, _ = _attempt_access(db.get(ExamAttempt, attempt_id), user, db)
    if finalize_expired_attempt(db, attempt):
        db.commit()
    session = db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt.id))
    if not session:
        raise HTTPException(404, detail={'code': 'PROCTORING_SESSION_NOT_FOUND', 'message': 'Proctoring session not found', 'details': None})
    RECORDING_DIR.mkdir(parents=True, exist_ok=True)
    destination = RECORDING_DIR / f'{attempt.id}.webm'
    size = 0
    try:
        with destination.open('wb') as output:
            while chunk := await recording.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_RECORDING_BYTES:
                    destination.unlink(missing_ok=True)
                    raise HTTPException(413, detail={'code': 'RECORDING_TOO_LARGE', 'message': 'Recording exceeds the 500 MB limit', 'details': None})
                output.write(chunk)
    finally:
        await recording.close()
    session.full_recording_url = f'/uploads/recordings/{attempt.id}.webm'
    session.ended_at = datetime.now(timezone.utc)
    db.commit()
    return ok({'attempt_id': attempt.id, 'recording_url': session.full_recording_url, 'size_bytes': size})


@router.post('/detection-events')
async def detection_event(user: User = Depends(current_user)):
    # Historical browser-generated AI detections are no longer authoritative.
    raise HTTPException(403, detail={'code':'TRUSTED_CHANNEL_REQUIRED',
        'message':'AI detections must come from a protected monitoring adapter.', 'details':None})


async def monitor(websocket: WebSocket, exam_id: UUID, db: Session = Depends(get_db)):
    from app.services.proctor_realtime import socket
    await socket(websocket, db, exam_id)
