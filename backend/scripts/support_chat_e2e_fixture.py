"""Create/clean disposable actors for real support chat browser tests.

The browser runner keeps generated credentials in memory. Cleanup accepts only
the exact generated actor IDs and checks the fixture email prefix.
"""
import json
import sys
from uuid import uuid4, UUID
from sqlalchemy import delete, select
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.entities import AuditLog, SupportConversation, User, UserRole


with SessionLocal() as db:
    if '--cleanup' in sys.argv:
        ids = [UUID(value) for value in json.load(sys.stdin)]
        users = db.scalars(select(User).where(User.id.in_(ids))).all()
        if any(not user.email.startswith('support-e2e-') for user in users):
            raise RuntimeError('Refusing to delete a non-fixture actor')
        db.execute(delete(SupportConversation).where(SupportConversation.owner_id.in_(ids)))
        db.execute(delete(AuditLog).where(AuditLog.user_id.in_(ids)))
        db.execute(delete(User).where(User.id.in_(ids)))
        db.commit()
        print('Disposable support chat actors removed')
    else:
        run = uuid4().hex[:12]
        password = 'E2e!' + uuid4().hex
        actors = {}
        for key, role in [('admin', UserRole.admin), ('student', UserRole.student), ('teacher', UserRole.teacher)]:
            user = User(id=uuid4(), full_name=f'Support E2E {key} {run}', email=f'support-e2e-{run}-{key}@example.com',
                        password_hash=hash_password(password), role=role, is_active=True,
                        student_code=f'E2E{run.upper()}' if role == UserRole.student else None)
            db.add(user)
            actors[key] = {'id': str(user.id), 'email': user.email, 'full_name': user.full_name, 'password': password}
        db.commit()
        print(json.dumps(actors))
