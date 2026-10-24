from uuid import UUID
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.core.database import get_db
from app.models.entities import User, UserRole
from app.schemas.auth import SelfProfileUpdate
from app.services.teacher_avatar import (MAX_AVATAR_BYTES, PRIVATE_HEADERS, avatar_error,
    avatar_path, avatar_url, sanitize_avatar, save_teacher_avatar)

router = APIRouter()


@router.post('/auth/me/avatar')
async def upload_avatar(request: Request, avatar: UploadFile = File(...), profile: str = Form('{}'),
                        db: Session = Depends(get_db), user: User = Depends(roles(UserRole.teacher))):
    form = await request.form()
    if set(form) - {'avatar', 'profile'} or len(form.getlist('avatar')) != 1 or len(form.getlist('profile')) > 1:
        raise avatar_error('VALIDATION_ERROR', 'Thông tin cập nhật hồ sơ không hợp lệ.')
    try:
        payload = SelfProfileUpdate.model_validate_json(profile)
    except ValidationError:
        raise avatar_error('VALIDATION_ERROR', 'Họ tên hoặc số điện thoại không hợp lệ.') from None
    content = await avatar.read(MAX_AVATAR_BYTES + 1)
    clean = await run_in_threadpool(sanitize_avatar, content, avatar.content_type)
    return await run_in_threadpool(save_teacher_avatar, db, user.id, clean, payload)


@router.get('/teachers/{teacher_id}/avatar/{image_id}')
def get_avatar(teacher_id: UUID, image_id: UUID, db: Session = Depends(get_db),
               viewer: User = Depends(roles(UserRole.teacher, UserRole.admin))):
    if viewer.role != UserRole.admin and viewer.id != teacher_id:
        raise avatar_error('FORBIDDEN', 'Bạn chỉ được xem ảnh hồ sơ của mình.', 403)
    teacher = db.get(User, teacher_id)
    if not teacher or teacher.role != UserRole.teacher or teacher.avatar_source != 'TEACHER_UPLOAD' or teacher.avatar_url != avatar_url(teacher_id, image_id):
        raise avatar_error('AVATAR_NOT_FOUND', 'Không tìm thấy ảnh đại diện.', 404)
    try:
        content = avatar_path(teacher_id, image_id).read_bytes()
    except OSError:
        raise avatar_error('AVATAR_NOT_FOUND', 'Không tìm thấy ảnh đại diện.', 404) from None
    return Response(content, media_type='image/jpeg', headers=PRIVATE_HEADERS)
