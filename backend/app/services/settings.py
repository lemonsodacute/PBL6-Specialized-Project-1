from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from app.models.entities import Notification, NotificationType, SystemSettings, User, UserRole, UserSettings

# These types have real producers today. Security/identity/card/termination notices
# are deliberately excluded so preferences cannot suppress them.
OPTIONAL_NOTIFICATIONS = {
    UserRole.student: {},
    UserRole.teacher: {
        'violation_alert': 'Cảnh báo giám sát',
        'exam_summary': 'Tổng kết kỳ thi',
    },
    UserRole.admin: {'profile_verification_request': 'Yêu cầu xác minh hồ sơ mới'},
}
EXAM_FIELDS = ('exam_duration_minutes', 'exam_require_camera', 'exam_require_mic')


def system_settings(db: Session) -> SystemSettings:
    # Migration creates the singleton. No environment/secrets are serialized here.
    return db.get(SystemSettings, 1)


def exam_defaults(db: Session, user: User) -> dict:
    system = system_settings(db)
    personal = db.get(UserSettings, user.id) if user.role == UserRole.teacher else None
    return {key: getattr(personal, key) if personal and getattr(personal, key) is not None else getattr(system, key)
            for key in EXAM_FIELDS}


def serialize_personal(db: Session, user: User) -> dict:
    row = db.get(UserSettings, user.id)
    allowed = OPTIONAL_NOTIFICATIONS[user.role]
    preferences = row.notification_preferences if row else {}
    return {
        'theme': row.theme if row else 'system',
        'notification_preferences': {key: preferences.get(key, True) for key in allowed},
        'notification_options': [{'key': key, 'label': label} for key, label in allowed.items()],
        'exam_defaults': exam_defaults(db, user) if user.role in (UserRole.teacher, UserRole.admin) else None,
        'exam_overrides': {key: getattr(row, key) if row else None for key in EXAM_FIELDS} if user.role == UserRole.teacher else None,
        'updated_at': row.updated_at if row else None,
    }


def notification_visibility(db: Session, user: User):
    if not OPTIONAL_NOTIFICATIONS[user.role]:
        return None
    row = db.get(UserSettings, user.id)
    preferences = row.notification_preferences if row else {}
    muted = [NotificationType(key) for key in OPTIONAL_NOTIFICATIONS[user.role] if preferences.get(key) is False]
    if not muted:
        return None
    # Even optional alert categories cannot hide critical/high severity security notices.
    return or_(Notification.type.not_in(muted), Notification.severity.in_(['high', 'critical']))
