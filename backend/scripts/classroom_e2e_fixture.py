"""Explicit, removable fixture for real SFU browser tests; never demo UI data.

Run from backend: python -m scripts.classroom_e2e_fixture [--cleanup]
"""
import json
import os
import sys
from pathlib import Path
from uuid import UUID, uuid4
from sqlalchemy import delete
from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.models.entities import Class, ClassEnrollment, User, UserRole

path = Path(os.environ.get('CLASSROOM_FIXTURE_PATH', 'private/classroom-e2e.json'))

def refresh():
    """Refresh expiring tokens without deleting a fixture's classroom history."""
    data = json.loads(path.read_text('utf-8'))
    with SessionLocal() as db:
        for key in ('teacher', 'student', 'second', 'outsider', 'other'):
            user = db.get(User, UUID(data[key]['user']['id']))
            if user is None or not user.is_active or user.role.value != data[key]['user']['role']:
                raise RuntimeError('Fixture account is missing or changed; tokens not refreshed')
            data[key]['token'] = create_access_token(str(user.id), user.role.value)
    path.write_text(json.dumps(data), encoding='utf-8')
    print('Classroom fixture tokens refreshed (not printed).')

def cleanup():
    if not path.exists(): return
    data = json.loads(path.read_text('utf-8'))
    with SessionLocal() as db:
        db.execute(delete(Class).where(Class.id.in_([UUID(data['class_id']), UUID(data['other_class_id'])])))
        db.execute(delete(User).where(User.id.in_([UUID(data[key]['user']['id']) for key in ('teacher', 'student', 'second', 'outsider', 'other')])))
        db.commit()
    path.unlink()
    print('Classroom E2E fixtures removed.')

def seed():
    if path.exists():
        raise SystemExit('Existing classroom fixture found; run --cleanup first.')
    with SessionLocal() as db:
        users = {}
        for key, role in (('teacher', UserRole.teacher), ('student', UserRole.student), ('second', UserRole.student), ('outsider', UserRole.student), ('other', UserRole.teacher)):
            users[key] = User(id=uuid4(), full_name=f'E2E {key.title()}', email=f'classroom-e2e-{uuid4().hex}@example.test', role=role, is_active=True, password_hash='test-fixture-no-password-login')
            db.add(users[key])
        db.flush()
        cls = Class(id=uuid4(), name='E2E Online Classroom', homeroom_teacher_id=users['teacher'].id)
        other = Class(id=uuid4(), name='E2E Other Classroom', homeroom_teacher_id=users['other'].id)
        db.add_all([cls, other]); db.flush()
        for key in ('student', 'second'): db.add(ClassEnrollment(id=uuid4(), class_id=cls.id, student_id=users[key].id))
        db.commit()
        data = {'class_id': str(cls.id), 'other_class_id': str(other.id)}
        for key, user in users.items():
            data[key] = {'user': {'id': str(user.id), 'full_name': user.full_name, 'email': user.email, 'role': user.role.value, 'is_active': True}, 'token': create_access_token(str(user.id), user.role.value)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding='utf-8')
    print('Real DB fixtures created in backend/private/classroom-e2e.json (tokens not printed).')

if __name__ == '__main__':
    cleanup() if '--cleanup' in sys.argv else refresh() if '--refresh' in sys.argv else seed()
