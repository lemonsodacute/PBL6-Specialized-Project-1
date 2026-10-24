"""Teacher avatars are ordinary profile images, independent of student identity."""
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4
import re
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.exc import SQLAlchemyError

from app.models.entities import UserRole
from app.schemas.auth import UserProfile
from app.services.audit import record_audit
from app.services.profile_avatar import public_profile
from app.services.student_identity_profile import lock_user

AVATAR_ROOT = Path(__file__).resolve().parents[2] / 'private' / 'teacher-avatars'
MAX_AVATAR_BYTES = 5 * 1024 * 1024
MAX_AVATAR_PIXELS = 16_000_000
PRIVATE_HEADERS = {'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff'}


def avatar_error(code, message, status=422):
    return HTTPException(status, detail={'code': code, 'message': message, 'details': None}, headers=PRIVATE_HEADERS)


def avatar_url(user_id, image_id):
    return f'/api/v1/teachers/{user_id}/avatar/{image_id}'


def avatar_path(user_id, image_id):
    # Both components are parsed UUIDs; user filenames never become storage paths.
    root = AVATAR_ROOT.resolve()
    path = (root / str(UUID(str(user_id))) / f'{UUID(str(image_id))}.jpg').resolve()
    if not path.is_relative_to(root):
        raise avatar_error('AVATAR_NOT_FOUND', 'Không tìm thấy ảnh đại diện.', 404)
    return path


def sanitize_avatar(content, content_type):
    if content_type not in {'image/jpeg', 'image/png'}:
        raise avatar_error('INVALID_AVATAR', 'Chỉ chấp nhận ảnh JPG hoặc PNG.')
    if not content or len(content) > MAX_AVATAR_BYTES:
        raise avatar_error('AVATAR_TOO_LARGE', 'Ảnh đại diện phải có dung lượng tối đa 5 MB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.format != {'image/jpeg': 'JPEG', 'image/png': 'PNG'}[content_type]:
                    raise ValueError('Image format does not match MIME')
                if image.width * image.height > MAX_AVATAR_PIXELS or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('Image dimensions or frame count invalid')
                image.verify()
            with Image.open(BytesIO(content)) as image:
                image.load()
                normalized = ImageOps.exif_transpose(image).convert('RGBA')
                normalized = ImageOps.fit(normalized, (512, 512), method=Image.Resampling.LANCZOS)
                clean = Image.new('RGB', normalized.size, 'white')
                clean.paste(normalized, mask=normalized.getchannel('A'))
                output = BytesIO()
                # Re-encode pixels only: no original file, EXIF or other metadata.
                clean.save(output, format='JPEG', quality=88, optimize=True)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise avatar_error('INVALID_AVATAR', 'Không đọc được ảnh. Hãy chọn ảnh JPG hoặc PNG hợp lệ, tối đa 16 triệu điểm ảnh.') from None


def remove_avatar(path):
    try:
        path.unlink(missing_ok=True)
    except OSError:
        # A stale file cannot be read: the GET route checks the current DB pointer.
        pass


def save_teacher_avatar(db, user_id, content, payload):
    new_path = None
    old_path = None
    try:
        current = lock_user(db, user_id)
        if not current.is_active or current.role != UserRole.teacher:
            raise avatar_error('FORBIDDEN', 'Cần tài khoản giảng viên đang hoạt động.', 403)
        if current.avatar_source == 'TEACHER_UPLOAD' and current.avatar_url:
            old = re.fullmatch(r'/api/v1/teachers/([0-9a-f-]+)/avatar/([0-9a-f-]+)', current.avatar_url)
            if old and old.group(1) == str(current.id):
                old_path = avatar_path(current.id, old.group(2))
        image_id = uuid4()
        new_path = avatar_path(current.id, image_id)
        new_path.parent.mkdir(parents=True, exist_ok=True)
        with new_path.open('xb') as output:
            output.write(content)
        changed = []
        if 'full_name' in payload.model_fields_set and current.full_name != payload.full_name:
            current.full_name = payload.full_name
            changed.append('full_name')
        if 'phone' in payload.model_fields_set and current.phone != payload.phone:
            current.phone = payload.phone
            changed.append('phone')
        current.avatar_url = avatar_url(current.id, image_id)
        current.avatar_source = 'TEACHER_UPLOAD'
        current.avatar_reference_id = None
        current.avatar_updated_at = datetime.now(timezone.utc)
        record_audit(db, action='PROFILE_UPDATED', user_id=current.id, entity_type='user', entity_id=current.id,
                     metadata={'fields': [*changed, 'avatar']})
        # Image and accompanying personal fields become visible together.
        db.flush()
        result = public_profile(db, current, UserProfile)
        db.commit()
    except (SQLAlchemyError, OSError):
        db.rollback()
        if new_path:
            remove_avatar(new_path)
        raise avatar_error('PROFILE_UPDATE_FAILED', 'Không thể lưu hồ sơ. Vui lòng thử lại.', 503) from None
    if old_path:
        remove_avatar(old_path)
    return {'user': result}
