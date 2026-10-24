"""Authenticated access to legacy proctoring media URLs."""
from pathlib import Path
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.api.v1.proctoring import _attempt_access, RECORDING_DIR
from app.core.database import get_db
from app.models.entities import DetectionEvent, ExamAttempt, ProctoringSession, User
from app.services.snapshots import UPLOAD_DIR
from app.services.reports import _exam_for_user

router = APIRouter()
PRIVATE_HEADERS = {'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff'}


def missing():
    return HTTPException(404, detail={'code': 'MEDIA_NOT_FOUND', 'message': 'Media not found', 'details': None})


def file_at(root: Path, filename: str, media_type: str):
    target = (root / filename).resolve()
    if target.parent != root.resolve() or not target.is_file():
        raise missing()
    return FileResponse(target, media_type=media_type, headers=PRIVATE_HEADERS)


@router.get('/uploads/recordings/{filename}')
def recording(filename: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not re.fullmatch(r'[0-9a-fA-F-]{36}\.webm', filename):
        raise missing()
    try:
        attempt_id = UUID(filename[:-5])
    except ValueError:
        raise missing() from None
    _attempt_access(db.get(ExamAttempt, attempt_id), user, db)
    session = db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt_id))
    if not session or session.full_recording_url != f'/uploads/recordings/{filename}':
        raise missing()
    return file_at(RECORDING_DIR, filename, 'video/webm')


@router.get('/uploads/{filename}')
def snapshot(filename: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not re.fullmatch(r'[0-9a-f]{32}\.(jpg|png|webp)', filename):
        raise missing()
    event = db.scalar(select(DetectionEvent).where(DetectionEvent.snapshot_url == f'/uploads/{filename}'))
    if not event:
        raise missing()
    _attempt_access(db.get(ExamAttempt, event.attempt_id), user, db)
    return file_at(UPLOAD_DIR, filename, {'jpg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp'}[filename.rsplit('.', 1)[1]])


@router.get('/uploads/reports/{filename}')
def report_export(filename: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    match = re.fullmatch(r'exam-([0-9a-f-]{36})-[0-9]{8}T[0-9]{6}Z\.(csv|xlsx)', filename)
    if not match:
        raise missing()
    try:
        exam_id = UUID(match.group(1))
    except ValueError:
        raise missing() from None
    _exam_for_user(exam_id, db, user)
    response = file_at(UPLOAD_DIR / 'reports', filename, 'text/csv' if match.group(2) == 'csv' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response
