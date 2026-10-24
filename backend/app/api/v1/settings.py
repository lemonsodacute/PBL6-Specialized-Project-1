from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from app.api.deps import current_user, roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import SystemSettings, User, UserRole, UserSettings
from app.schemas.settings import PersonalSettingsPatch, SystemSettingsPatch
from app.services.audit import record_audit
from app.services.settings import EXAM_FIELDS, OPTIONAL_NOTIFICATIONS, serialize_personal, system_settings

router = APIRouter()

def serialize_system(row):
    return {**{field: getattr(row, field) for field in EXAM_FIELDS}, 'support_text': row.support_text, 'updated_at': row.updated_at}

@router.get('/settings/me')
def get_personal(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return ok(serialize_personal(db, user))

@router.patch('/settings/me')
def update_personal(payload: PersonalSettingsPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    changes = payload.model_dump(exclude_unset=True)
    if any(key in changes for key in EXAM_FIELDS) and user.role != UserRole.teacher:
        raise HTTPException(403, detail={'code':'FORBIDDEN', 'message':'Only teachers can set personal exam defaults', 'details':None})
    preferences = changes.get('notification_preferences', {})
    if set(preferences) - set(OPTIONAL_NOTIFICATIONS[user.role]):
        raise HTTPException(422, detail={'code':'INVALID_NOTIFICATION_PREFERENCE', 'message':'This notification preference is unavailable or mandatory', 'details':None})
    if not changes: return ok(serialize_personal(db, user))
    insert = sqlite_insert if db.bind.dialect.name == 'sqlite' else pg_insert
    db.execute(insert(UserSettings).values(user_id=user.id, theme='system', notification_preferences={})
               .on_conflict_do_nothing(index_elements=['user_id']))
    row = db.scalar(select(UserSettings).where(UserSettings.user_id == user.id).with_for_update().execution_options(populate_existing=True))
    for field, value in changes.items():
        setattr(row, field, {**row.notification_preferences, **value} if field == 'notification_preferences' else value)
    row.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(row)
    return ok(serialize_personal(db, user))

@router.get('/settings/support')
def support(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return ok({'support_text': system_settings(db).support_text})

@router.get('/admin/settings')
def get_system(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin))):
    return ok(serialize_system(system_settings(db)))

@router.patch('/admin/settings')
def update_system(payload: SystemSettingsPatch, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin))):
    row = db.scalar(select(SystemSettings).where(SystemSettings.id == 1).with_for_update().execution_options(populate_existing=True))
    updates = payload.model_dump(exclude_unset=True)
    changed = {key: {'old': getattr(row, key), 'new': value} for key, value in updates.items() if getattr(row, key) != value}
    if changed:
        for key, change in changed.items(): setattr(row, key, change['new'])
        row.updated_at = datetime.now(timezone.utc)
        record_audit(db, action='SYSTEM_SETTINGS_UPDATED', user_id=user.id, entity_type='system_settings', metadata={'changes':changed})
        db.commit(); db.refresh(row)
    return ok(serialize_system(row))
