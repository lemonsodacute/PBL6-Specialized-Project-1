from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response, File, UploadFile, Request
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.core.database import get_db
from app.api.responses import ok
from app.models.entities import User, UserRole
from app.services.student_card_previews import PRIVATE_HEADERS, load_preview, read_image
from app.services.student_card_previews import preview_error, require_profile
from app.services.student_card_identity import create_card_preview, confirm_card, reference_status
from app.services.face_recognition import MAX_IMAGE_BYTES

router = APIRouter()


class ConfirmCard(BaseModel):
    model_config = ConfigDict(extra='forbid')
    preview_id: UUID


@router.get('/status')
def card_status(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    return ok(reference_status(db, user))


@router.post('/preview')
async def card_preview(request: Request, image: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    require_profile(user)
    form = await request.form()
    if len(form.multi_items()) != 1 or set(form) != {'image'}:
        raise preview_error('VALIDATION_ERROR', 'Chỉ gửi ảnh thẻ sinh viên.', 422)
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise preview_error('IMAGE_TOO_LARGE', 'Ảnh không được vượt quá 8 MB.', 413)
    return ok(await run_in_threadpool(create_card_preview, db, user, content, image.content_type))


@router.post('/confirm')
def card_confirm(payload: ConfirmCard, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    return ok(confirm_card(db, user, payload.preview_id))


@router.get('/previews/{preview_id}/{kind}')
def preview_image(preview_id: UUID, kind: Literal['card', 'face'], db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    row = load_preview(db, preview_id, user)
    return Response(read_image(row, kind), media_type='image/jpeg', headers=PRIVATE_HEADERS)
