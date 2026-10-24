from uuid import UUID
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session
from app.api.deps import roles
from app.core.database import get_db
from app.models.entities import User, UserRole
from app.services.student_card_identity import active_reference
from app.services.student_card_previews import PRIVATE_HEADERS
from app.services.student_identity_profile import profile_error

router = APIRouter()


@router.get('/users/{student_id}/avatar/{reference_id}')
def get_avatar(student_id: UUID, reference_id: UUID, db: Session = Depends(get_db), viewer: User = Depends(roles(UserRole.student, UserRole.admin))):
    if viewer.role != UserRole.admin and viewer.id != student_id:
        raise profile_error('FORBIDDEN', 'Bạn chỉ được xem ảnh hồ sơ của mình.', 403)
    student = db.get(User, student_id)
    if not student or student.role != UserRole.student:
        raise profile_error('NOT_FOUND', 'Không tìm thấy ảnh hồ sơ.', 404)
    reference = active_reference(db, student)
    if reference is None or reference.id != reference_id or not reference.sanitized_face:
        raise profile_error('NOT_FOUND', 'Ảnh hồ sơ không còn khả dụng.', 404)
    return Response(reference.sanitized_face, media_type='image/jpeg', headers=PRIVATE_HEADERS)
