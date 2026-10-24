import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4
from sqlalchemy import create_engine, select, text
from fastapi.testclient import TestClient
from app.core.database import get_db, engine as production_engine
from app.core.security import create_access_token
from app.main import app
from app.models.base import Base
from app.models.entities import (AuditLog, Exam, Notification, NotificationType, SystemSettings, User, UserRole, UserSettings)
from sqlalchemy.orm import Session
from app.models.entities import SupportConversation
from tests import test_teacher_results as fixtures


class SettingsTests(TestCase):
    def setUp(self):
        fixtures.TeacherResultsTests.setUp(self)
        for model in (UserSettings, SystemSettings, SupportConversation, Notification): model.__table__.create(self.db.bind)
        self.db.add(SystemSettings(id=1, exam_duration_minutes=60, exam_require_camera=True,
                                   exam_require_mic=True, support_text='Contact your administrator.'))
        self.db.commit()

    attempt = fixtures.TeacherResultsTests.attempt
    headers = fixtures.TeacherResultsTests.headers

    def personal(self, actor=None, **body):
        return self.client.patch('/api/v1/settings/me', headers=self.headers(actor), json=body)

    def system(self, actor=None, **body):
        return self.client.patch('/api/v1/admin/settings', headers=self.headers(actor or self.admin), json=body)

    def get(self, actor=None, path='/settings/me'):
        return self.client.get('/api/v1' + path, headers=self.headers(actor))

    def test_theme_persists_per_account_and_roles(self):
        for actor in (self.student, self.teacher, self.admin):
            self.assertEqual(self.get(actor).json()['data']['theme'], 'system')
            response = self.personal(actor, theme='dark')
            self.assertEqual(response.status_code, 200, response.text)
            self.db.expire_all()
            self.assertEqual(self.db.get(UserSettings, actor.id).theme, 'dark')
            self.assertEqual(self.get(actor).json()['data']['theme'], 'dark')
        self.assertEqual(self.get(self.other).json()['data']['theme'], 'system')
        self.assertEqual(self.personal(self.student, theme='light').json()['data']['theme'], 'light')
        self.assertEqual(self.get(self.teacher).json()['data']['theme'], 'dark')

    def test_auth_roles_no_secrets_or_unknown_fields(self):
        self.assertEqual(self.client.get('/api/v1/settings/me').status_code, 401)
        for actor in (self.teacher, self.student):
            self.assertEqual(self.get(actor, '/admin/settings').status_code, 403)
            self.assertEqual(self.system(actor, exam_duration_minutes=90).status_code, 403)
        for key in ('student_id', 'user_id', 'role', 'sface_threshold', 'jwt_secret', 'api_key', 'auto_submit'):
            self.assertEqual(self.personal(**{key:'untrusted'}).status_code, 422)
            self.assertEqual(self.system(**{key:'untrusted'}).status_code, 422)
        for actor in (self.student, self.admin):
            self.assertEqual(self.personal(actor, exam_duration_minutes=90).status_code, 403)
        self.assertEqual(set(self.get(self.admin, '/admin/settings').json()['data']),
                         {'exam_duration_minutes','exam_require_camera','exam_require_mic','support_text','updated_at'})

    def test_validation_and_nullable_teacher_inheritance(self):
        for body in ({'theme':'invalid'}, {'theme':None}, {'notification_preferences':None},
                     {'exam_duration_minutes':0}, {'exam_duration_minutes':1441}, {'exam_duration_minutes':1.5},
                     {'exam_require_camera':'false'}, {'notification_preferences':{'exam_summary':'false'}}):
            self.assertEqual(self.personal(**body).status_code, 422)
        for body in ({'exam_duration_minutes':None}, {'support_text':' '}, {'exam_require_camera':None}, {'support_text':'x'*2001}):
            self.assertEqual(self.system(**body).status_code, 422)
        self.assertEqual(self.personal(exam_duration_minutes=90, exam_require_camera=False).status_code, 200)
        self.assertEqual(self.personal(exam_duration_minutes=None, exam_require_camera=None).json()['data']['exam_defaults']['exam_duration_minutes'], 60)

    def test_defaults_consumed_by_new_exams_explicit_values_and_existing_exams_preserved(self):
        old_duration = self.exam.duration_minutes
        self.assertEqual(self.personal(exam_duration_minutes=90, exam_require_camera=False, exam_require_mic=True).status_code, 200)
        self.assertEqual(self.system(exam_duration_minutes=120, exam_require_camera=True, exam_require_mic=False).status_code, 200)
        self.assertEqual(self.get().json()['data']['exam_defaults']['exam_duration_minutes'], 90)
        self.assertEqual(self.get(self.other).json()['data']['exam_defaults']['exam_duration_minutes'], 120)
        now = datetime.now(timezone.utc)
        payload = {'title':'Settings new exam', 'start_time':now.isoformat(), 'end_time':(now + timedelta(hours=3)).isoformat()}
        response = self.client.post('/api/v1/exams', headers=self.headers(), json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        created = response.json()['data']
        self.assertEqual(created['duration_minutes'], 90); self.assertFalse(created['require_camera']); self.assertTrue(created['require_mic'])
        response = self.client.post('/api/v1/exams', headers=self.headers(), json={**payload, 'duration_minutes':30, 'require_camera':True, 'require_mic':False})
        self.assertEqual(response.status_code, 200, response.text)
        created = response.json()['data']; self.assertEqual(created['duration_minutes'], 30); self.assertTrue(created['require_camera']); self.assertFalse(created['require_mic'])
        self.db.refresh(self.exam); self.assertEqual(self.exam.duration_minutes, old_duration)
        self.db.refresh(self.submitted); self.assertEqual(self.submitted.score, Decimal('1'))

    def test_admin_audit_atomic_real_changes_noop_and_support_shared(self):
        response = self.system(exam_duration_minutes=90, support_text='  Contact the faculty office.  ')
        self.assertEqual(response.status_code, 200, response.text)
        logs = self.db.scalars(select(AuditLog).where(AuditLog.action == 'SYSTEM_SETTINGS_UPDATED')).all()
        self.assertEqual(len(logs), 1); self.assertEqual(logs[0].user_id, self.admin.id)
        self.assertEqual(logs[0].metadata_json['changes']['exam_duration_minutes'], {'old':60, 'new':90})
        self.assertEqual(logs[0].metadata_json['changes']['support_text']['new'], 'Contact the faculty office.')
        self.assertEqual(self.system(exam_duration_minutes=90).status_code, 200)
        self.assertEqual(len(self.db.scalars(select(AuditLog)).all()), 1)
        for actor in (self.student, self.teacher, self.admin):
            support = self.get(actor, '/settings/support').json()['data']
            self.assertEqual(support, {'support_text':'Contact the faculty office.'})

    def test_optional_notifications_really_filter_list_and_badge_critical_cannot_be_muted(self):
        for kind, severity in ((NotificationType.exam_summary,None), (NotificationType.violation_alert,'low'),
                               (NotificationType.violation_alert,'critical'), (NotificationType.attempt_terminated,None)):
            self.db.add(Notification(id=uuid4(), recipient_user_id=self.teacher.id, type=kind,
                                     title='Settings test notice', message='Test notification', severity=severity, is_read=False))
        self.db.commit()
        self.assertEqual(self.personal(notification_preferences={'exam_summary':False, 'violation_alert':False}).status_code, 200)
        rows = self.get(path='/notifications').json()['data']
        self.assertEqual(len(rows), 2)
        self.assertEqual({row['type'] for row in rows}, {'violation_alert','attempt_terminated'})
        self.assertEqual(self.get(path='/notifications/unread-count').json()['data']['count'], 2)
        # Notifications remain stored; preference updates neither delete nor mark them read.
        self.assertEqual(len(self.db.scalars(select(Notification)).all()), 4)
        self.assertEqual(self.personal(notification_preferences={'exam_summary':True, 'violation_alert':True}).status_code, 200)
        self.assertEqual(self.get(path='/notifications/unread-count').json()['data']['count'], 4)

    def test_security_categories_and_role_specific_preferences_cannot_be_changed(self):
        for kind in ('student_card_update','student_card_notice','profile_verification_result','attempt_terminated'):
            for actor in (self.student, self.teacher, self.admin):
                self.assertEqual(self.personal(actor, notification_preferences={kind:False}).status_code, 422)
        self.assertEqual(self.personal(self.student, notification_preferences={'violation_alert':False}).status_code, 422)
        self.assertEqual(self.personal(self.admin, notification_preferences={'profile_verification_request':False}).status_code, 200)
        self.assertEqual(self.personal(self.teacher, notification_preferences={'profile_verification_request':False}).status_code, 422)

    def test_partial_saves_merge_and_preserve_other_sections(self):
        self.personal(theme='dark', exam_duration_minutes=90, notification_preferences={'exam_summary':False})
        self.personal(notification_preferences={'violation_alert':False})
        data = self.get().json()['data']
        self.assertEqual(data['theme'], 'dark'); self.assertEqual(data['exam_defaults']['exam_duration_minutes'], 90)
        self.assertEqual(data['notification_preferences'], {'exam_summary':False, 'violation_alert':False})


@skipUnless(os.environ.get('RUN_SETTINGS_POSTGRES_TESTS') == '1', 'Opt-in isolated PostgreSQL schema')
class SettingsPostgresTests(TestCase):
    def test_http_patch_persists_in_postgresql_and_system_audit(self):
        schema = 'settings_test_' + uuid4().hex
        self.assertTrue(schema.startswith('settings_test_') and schema.replace('_','').isalnum())
        # A private test schema avoids changing real accounts, system defaults or live exams.
        with production_engine.begin() as connection: connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(production_engine.url, connect_args={'options':f'-csearch_path={schema}'})
        try:
            Base.metadata.create_all(engine)
            with Session(engine) as db:
                teacher = User(id=uuid4(), full_name='Settings PostgreSQL Test', email=f'{uuid4()}@example.test', password_hash='unused', role=UserRole.teacher, is_active=True)
                admin = User(id=uuid4(), full_name='Settings Admin Test', email=f'{uuid4()}@example.test', password_hash='unused', role=UserRole.admin, is_active=True)
                db.add_all([teacher,admin, SystemSettings(id=1, support_text='Test support', exam_duration_minutes=60, exam_require_camera=True, exam_require_mic=True)]); db.commit()
                teacher_id, admin_id = teacher.id, admin.id
            def session():
                with Session(engine) as db: yield db
            with patch.dict(app.dependency_overrides, {get_db:session}), TestClient(app) as client:
                headers = {'Authorization':f'Bearer {create_access_token(str(teacher_id), "teacher")}'}
                response = client.patch('/api/v1/settings/me', headers=headers, json={'theme':'dark','exam_duration_minutes':90})
                self.assertEqual(response.status_code,200,response.text)
                response = client.get('/api/v1/settings/me', headers=headers)
                self.assertEqual(response.json()['data']['theme'],'dark')
                self.assertEqual(response.json()['data']['exam_defaults']['exam_duration_minutes'],90)
                admin_headers = {'Authorization':f'Bearer {create_access_token(str(admin_id), "admin")}'}
                response = client.patch('/api/v1/admin/settings', headers=admin_headers, json={'exam_duration_minutes':120})
                self.assertEqual(response.status_code,200,response.text)
            with Session(engine) as db:
                self.assertEqual(db.bind.dialect.name,'postgresql')
                row = db.get(UserSettings, teacher_id); self.assertEqual(row.theme,'dark'); self.assertEqual(row.exam_duration_minutes,90)
                self.assertEqual(db.get(SystemSettings,1).exam_duration_minutes,120)
                log = db.scalar(select(AuditLog).where(AuditLog.action=='SYSTEM_SETTINGS_UPDATED'))
                self.assertEqual(log.user_id,admin_id); self.assertEqual(log.metadata_json['changes']['exam_duration_minutes'],{'old':60,'new':120})
        finally:
            engine.dispose()
            with production_engine.begin() as connection: connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
