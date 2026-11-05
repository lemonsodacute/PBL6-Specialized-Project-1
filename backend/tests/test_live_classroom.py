import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch, AsyncMock
from uuid import UUID, uuid4

import jwt
from fastapi import HTTPException
from fastapi.testclient import TestClient
from livekit import api
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.entities import Class, ClassAttendance, ClassEnrollment, ClassRecording, LiveClass, StudentCardReference, User, UserRole
from app.services.classroom_attendance import connected, disconnected, utc
from app.services.classroom_provider import LiveKitProvider, get_classroom_provider, room_name


class TestProvider(LiveKitProvider):
    __test__ = False
    def __init__(self):
        self.settings = Settings(_env_file=None, LIVEKIT_URL='ws://localhost:7880', LIVEKIT_API_KEY='test-key', LIVEKIT_API_SECRET='test-only-classroom-secret-at-least-32-bytes')
        self.current = {}
        self.created = []
        self.closed = []
        self.removed = []
        self.fail_close = False
        self.events = []
        self.policies = []
        self.updated = []

    async def ensure_room(self, name): self.created.append(name)
    async def close_room(self, name):
        if self.fail_close: raise HTTPException(503)
        self.closed.append(name)
    async def participant(self, name, identity): return self.current.get(identity)
    async def remove(self, name, identity): self.removed.append(identity); self.current.pop(identity, None)
    async def participants(self, name): return list(self.current.values())
    async def metadata(self, item, value): self.policies.append(value['policy'].copy())
    async def permissions(self, item, participant, value): self.updated.append(value)
    async def send(self, name, topic, value, identities=None): self.events.append((topic, value, identities))
    async def mute(self, name, participant): self.events.append(('mute', participant.identity))


class LiveClassroomTests(TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        self.addCleanup(self.engine.dispose)
        @event.listens_for(self.engine, 'connect')
        def configure(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)
        for model in (User, StudentCardReference, Class, ClassEnrollment, LiveClass, ClassAttendance, ClassRecording): model.__table__.create(self.engine)
        self.db = self.enterContext(Session(self.engine, expire_on_commit=False))
        self.teacher, self.other, self.student, self.outsider = [User(id=uuid4(), full_name='Classroom Test', email=f'{uuid4()}@example.test', password_hash='unused', role=role, is_active=True) for role in (UserRole.teacher, UserRole.teacher, UserRole.student, UserRole.student)]
        self.db.add_all([self.teacher, self.other, self.student, self.outsider]); self.db.flush()
        self.cls = Class(id=uuid4(), name='Test class', homeroom_teacher_id=self.teacher.id)
        self.other_cls = Class(id=uuid4(), name='Other class', homeroom_teacher_id=self.other.id)
        self.db.add_all([self.cls, self.other_cls]); self.db.flush()
        self.db.add(ClassEnrollment(id=uuid4(), class_id=self.cls.id, student_id=self.student.id)); self.db.commit()
        self.provider = TestProvider()
        self.notifications = self.enterContext(patch('app.api.v1.live_classes.create_notification'))
        self.enterContext(patch.dict(app.dependency_overrides, {get_db: lambda: self.db, get_classroom_provider: lambda: self.provider}))
        self.enterContext(patch('app.api.v1.live_classes.get_classroom_provider', return_value=self.provider))
        self.enterContext(patch('app.services.classroom_lifecycle.get_settings', return_value=Settings(_env_file=None)))
        self.client = self.enterContext(TestClient(app))
        self.start_time = datetime.now(timezone.utc)
        self.item = self.create().json()['data']
        self.id = self.item['id']

    def headers(self, actor=None):
        user = actor or self.teacher
        return {'Authorization': f'Bearer {create_access_token(str(user.id), user.role.value)}'}

    def create(self, actor=None, **patches):
        payload = {'class_id': str(self.cls.id), 'title': 'Online class', 'scheduled_start': self.start_time.isoformat(), 'scheduled_end': (self.start_time + timedelta(hours=1)).isoformat()} | patches
        return self.client.post('/api/v1/live-classes', json=payload, headers=self.headers(actor))

    def post(self, action, actor=None, body=None):
        return self.client.post(f'/api/v1/live-classes/{self.id}/{action}', json=body, headers=self.headers(actor))

    def row(self): return self.db.scalar(select(ClassAttendance).where(ClassAttendance.live_class_id == UUID(self.id)))

    def live(self): self.assertEqual(self.post('start').status_code, 200)

    def connect(self, sid='PA_current'):
        self.provider.current[str(self.student.id)] = SimpleNamespace(sid=sid, identity=str(self.student.id), metadata='{}', tracks=[])
        return self.post('join', self.student, {'participant_sid': sid})

    def webhook(self, event_name, sid, *, at=None, signed=True):
        body = json.dumps({'event': event_name, 'room': {'name': room_name(UUID(self.id))}, 'participant': {'identity': str(self.student.id), 'sid': sid}, 'createdAt': int((at or datetime.now(timezone.utc)).timestamp())})
        digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        token = api.AccessToken(self.provider.settings.LIVEKIT_API_KEY, self.provider.settings.LIVEKIT_API_SECRET).with_sha256(digest).to_jwt()
        return self.client.post('/api/v1/live-classes/provider-webhook', content=body, headers={'Authorization': token if signed else 'forged', 'Content-Type': 'application/webhook+json'})

    def test_schedule_validates_order_timezone_and_blank_title(self):
        for patch_ in ({'title': '   '}, {'scheduled_end': self.start_time.isoformat()}, {'scheduled_end': (self.start_time - timedelta(seconds=1)).isoformat()}, {'scheduled_start': '2026-10-11T10:00:00'}):
            self.assertEqual(self.create(**patch_).status_code, 422)

    def test_other_teachers_cannot_create_or_manage_or_read(self):
        self.assertEqual(self.create(self.other).status_code, 404)
        for action in ('start', 'end', 'token'): self.assertEqual(self.post(action, self.other).status_code, 404)
        self.assertEqual(self.client.get(f'/api/v1/live-classes/{self.id}', headers=self.headers(self.other)).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/live-classes', headers=self.headers(self.other)).json()['data'], [])

    def test_students_cannot_start_end_or_read_teacher_attendance(self):
        for action in ('start', 'end'): self.assertEqual(self.post(action, self.student).status_code, 403)
        self.assertEqual(self.client.get(f'/api/v1/live-classes/{self.id}/attendance', headers=self.headers(self.student)).status_code, 403)

    def test_scheduled_and_ended_never_issue_token_or_join(self):
        for action, body in (('token', None), ('join', {'participant_sid': 'PA_fake'})):
            response = self.post(action, self.student, body)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()['error']['code'], 'ROOM_NOT_LIVE')
        self.live(); self.assertEqual(self.post('end').status_code, 200)
        ended = self.post('token', self.student)
        self.assertEqual(ended.status_code, 409)
        self.assertEqual(ended.json()['error']['code'], 'SESSION_ENDED')
        self.assertEqual(self.post('start').status_code, 409)
        self.assertIsNone(self.row())

    def test_start_once_and_distinct_room_per_session(self):
        self.live(); self.assertEqual(self.post('start').status_code, 409)
        second = self.create(title='Another session').json()['data']
        self.assertNotEqual(room_name(UUID(second['id'])), room_name(UUID(self.id)))
        self.assertEqual(self.provider.created, [room_name(UUID(self.id))])

    def test_enrollment_required_even_known_room_id_and_frontend_role(self):
        self.live()
        for action, body in (('token', None), ('join', {'participant_sid': 'PA_fake'})):
            self.assertEqual(self.post(action, self.outsider, body).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/live-classes', headers=self.headers(self.outsider)).json()['data'], [])
        self.assertEqual(self.client.get(f'/api/v1/live-classes/{self.id}', headers=self.headers(self.outsider)).status_code, 404)

    def test_signed_room_token_limited_grants_server_identity_short_ttl_no_attendance(self):
        self.live()
        response = self.post('token', self.student)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        data = response.json()['data']; claims = jwt.decode(data['token'], self.provider.settings.LIVEKIT_API_SECRET, algorithms=['HS256'])
        self.assertEqual(claims['sub'], str(self.student.id)); self.assertEqual(claims['video']['room'], room_name(UUID(self.id)))
        self.assertFalse(claims['video']['roomAdmin']); self.assertFalse(claims['video']['roomCreate']); self.assertFalse(claims['video']['canUpdateOwnMetadata'])
        self.assertLessEqual(claims['exp'] - claims['nbf'], 60)
        self.assertNotIn('secret', data); self.assertIsNone(self.row())
        self.assertEqual(data['server_url'], self.provider.settings.LIVEKIT_URL)
        self.assertEqual(self.post('token').status_code, 200)

    def test_token_failure_does_not_hide_provider_error_or_issue_credentials(self):
        self.live()
        for code in ('REALTIME_CONFIG_MISSING', 'REALTIME_CONNECTION_FAILED'):
            with patch.object(self.provider, 'ensure_room', AsyncMock(side_effect=HTTPException(503, detail={'code': code}))):
                response = self.post('token')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['error']['code'], code)
            self.assertNotIn('token', response.json())
        with patch.object(self.provider, 'token', side_effect=ValueError('private signing error')):
            response = self.post('token')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()['error']['code'], 'TOKEN_REQUEST_FAILED')
        self.assertNotIn('private signing error', response.text)

    def test_token_checks_auth_and_session_before_provider_configuration(self):
        with patch.object(self.provider, 'ensure_room', AsyncMock(side_effect=AssertionError('must not reach SFU'))):
            self.assertEqual(self.client.post(f'/api/v1/live-classes/{self.id}/token').status_code, 401)
            self.assertEqual(self.post('token', self.other).status_code, 404)
            self.assertEqual(self.post('token').json()['error']['code'], 'ROOM_NOT_LIVE')

    def test_missing_invalid_or_insecure_production_provider_configuration(self):
        base = {'LIVEKIT_API_KEY': 'test-key', 'LIVEKIT_API_SECRET': 'test-only-secret-longer-than-32-bytes',
                'JWT_SECRET': 'test-only-jwt-secret-longer-than-32-bytes', 'COOKIE_SECURE': None}
        for overrides in ({}, {'LIVEKIT_URL': 'https://rtc.example.test'}, {'LIVEKIT_URL': 'ws://'},
                          {'LIVEKIT_URL': 'ws://localhost:7880', 'LIVEKIT_API_SECRET': ''},
                          {'LIVEKIT_URL': 'ws://rtc.example.test', 'ENVIRONMENT': 'production'},
                          {'LIVEKIT_URL': 'wss://rtc.example.test?secret=do-not-log'}):
            with self.subTest(overrides=list(overrides)):
                self.provider.settings = Settings(_env_file=None, **(base | overrides))
                with self.assertRaises(HTTPException) as raised:
                    self.provider.token('classroom-test', 'teacher-test', 'Teacher')
                self.assertEqual(raised.exception.detail['code'], 'REALTIME_CONFIG_MISSING')
        self.provider.settings = Settings(_env_file=None, **base, LIVEKIT_URL='wss://rtc.example.test', ENVIRONMENT='production')
        self.assertEqual(self.provider.token('classroom-test', 'teacher-test', 'Teacher')['server_url'], 'wss://rtc.example.test')

    def test_join_requires_actual_provider_sid(self):
        self.live()
        self.assertEqual(self.post('join', self.student, {'participant_sid': 'PA_fake'}).status_code, 409)
        self.provider.current[str(self.student.id)] = SimpleNamespace(sid='PA_real')
        self.assertEqual(self.post('join', self.student, {'participant_sid': 'PA_fake'}).status_code, 409)
        self.assertIsNone(self.row())

    def test_duplicate_join_heartbeat_one_aggregate(self):
        self.live()
        for _ in range(4): self.assertEqual(self.connect().status_code, 200)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ClassAttendance)), 1)
        self.assertIsNotNone(self.row().active_since)

    def test_duration_excludes_gap_between_leave_and_rejoin(self):
        self.live(); at = datetime(2026, 10, 11, tzinfo=timezone.utc)
        connected(self.db, UUID(self.id), self.student.id, 'PA_one', at)
        disconnected(self.db, UUID(self.id), self.student.id, 'PA_one', at + timedelta(seconds=70))
        connected(self.db, UUID(self.id), self.student.id, 'PA_two', at + timedelta(seconds=600))
        disconnected(self.db, UUID(self.id), self.student.id, 'PA_two', at + timedelta(seconds=660))
        self.db.commit()
        self.assertEqual(self.row().duration_sec, 130)
        self.assertEqual(utc(self.row().joined_at), at)

    def test_stale_leave_and_webhook_cannot_close_new_refresh_connection(self):
        self.live(); self.connect('PA_old'); self.connect('PA_new')
        self.assertEqual(self.post('leave', self.student, {'participant_sid': 'PA_old'}).status_code, 200)
        self.assertEqual(self.webhook('participant_left', 'PA_old').status_code, 200)
        self.assertEqual(self.row().participant_sid, 'PA_new'); self.assertIsNotNone(self.row().active_since)
        self.assertEqual(self.provider.removed, [])

    def test_signed_webhook_actual_join_leave_idempotent_and_tamper_denied(self):
        self.live(); self.provider.current[str(self.student.id)] = SimpleNamespace(sid='PA_webhook')
        self.assertEqual(self.webhook('participant_joined', 'PA_webhook', signed=False).status_code, 401)
        self.assertIsNone(self.row())
        for _ in range(2): self.assertEqual(self.webhook('participant_joined', 'PA_webhook').status_code, 200)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ClassAttendance)), 1)
        for _ in range(2): self.assertEqual(self.webhook('participant_left', 'PA_webhook').status_code, 200)
        duration = self.row().duration_sec
        self.webhook('participant_joined', 'PA_webhook')
        self.assertIsNone(self.row().active_since); self.assertEqual(self.row().duration_sec, duration)

    def test_delayed_join_for_old_sid_cannot_replace_current_provider_sid(self):
        self.live(); self.connect('PA_new')
        self.webhook('participant_joined', 'PA_old')
        self.assertEqual(self.row().participant_sid, 'PA_new')

    def test_end_persists_during_provider_outage_then_retries_idempotently(self):
        self.live(); self.connect(); self.provider.fail_close = True
        ended = self.post('end'); self.assertEqual(ended.status_code, 200, ended.text)
        data = ended.json()['data']; self.assertEqual(data['status'], 'ended'); self.assertTrue(data['provider_close_pending'])
        self.assertIsNone(self.row().active_since); self.assertIsNotNone(self.row().left_at)
        self.assertEqual(self.post('token', self.student).status_code, 409)
        self.provider.fail_close = False
        again = self.post('end').json()['data']
        self.assertFalse(again['provider_close_pending']); self.assertEqual(utc(datetime.fromisoformat(data['actual_end'])), utc(datetime.fromisoformat(again['actual_end'])))
        self.assertEqual(self.provider.closed, [room_name(UUID(self.id))])

    def test_transferred_class_owner_denied(self):
        self.cls.homeroom_teacher_id = self.other.id; self.db.commit()
        self.assertEqual(self.post('start').status_code, 404)

    def test_attendance_has_actual_times_and_absentees_without_fake_join(self):
        self.live()
        url = f'/api/v1/live-classes/{self.id}/attendance'
        result = self.client.get(url, headers=self.headers()).json()['data']
        self.assertEqual(result[0]['status'], 'absent'); self.assertIsNone(result[0]['joined_at'])
        self.connect(); self.post('end')
        result = self.client.get(url, headers=self.headers()).json()['data']
        self.assertEqual(result[0]['status'], 'present'); self.assertIsNotNone(result[0]['joined_at']); self.assertIsNotNone(result[0]['left_at'])

    def test_removed_enrollment_cannot_rejoin_but_historical_attendance_remains(self):
        self.live(); self.connect()
        enrollment = self.db.scalar(select(ClassEnrollment).where(ClassEnrollment.student_id == self.student.id))
        self.db.delete(enrollment); self.db.commit()
        self.assertEqual(self.post('token', self.student).status_code, 404)
        self.assertEqual(self.post('leave', self.student, {'participant_sid': 'PA_current'}).status_code, 200)
        rows = self.client.get(f'/api/v1/live-classes/{self.id}/attendance', headers=self.headers()).json()['data']
        self.assertEqual(len(rows), 1); self.assertIsNotNone(rows[0]['left_at'])

    def test_waiting_room_admission_required_before_token_and_join(self):
        self.live()
        self.assertEqual(self.post('policy', body={'waiting_room': True}).status_code, 200)
        self.assertEqual(self.post('admission', self.student).json()['data']['status'], 'waiting')
        self.assertIsNone(self.row())
        self.assertEqual(self.post('token', self.student).json()['error']['code'], 'WAITING_FOR_ADMISSION')
        waiting = self.client.get(f'/api/v1/live-classes/{self.id}', headers=self.headers()).json()['data']['waiting']
        self.assertEqual(waiting[0]['id'], str(self.student.id))
        self.assertEqual(self.post('actions', self.student, {'action': 'admit_all'}).status_code, 403)
        self.assertEqual(self.post('actions', body={'action': 'admit_all'}).status_code, 200)
        self.assertEqual(self.post('token', self.student).status_code, 200)
        self.assertEqual(self.connect().status_code, 200)

    def test_rejection_and_removal_block_tokens_and_stale_signed_join(self):
        self.live(); self.connect()
        self.assertEqual(self.post('actions', body={'action': 'remove', 'participant_id': str(self.student.id)}).status_code, 200)
        self.assertIn(str(self.student.id), self.provider.removed)
        self.assertIsNone(self.row().active_since)
        for action in ('token', 'admission'):
            self.assertEqual(self.post(action, self.student).json()['error']['code'], 'REMOVED_BY_TEACHER')
        self.assertEqual(self.webhook('participant_joined', 'PA_stale').status_code, 200)
        self.assertEqual(self.provider.removed.count(str(self.student.id)), 2)

    def test_lock_blocks_new_entry_but_keeps_connected_participants(self):
        self.live()
        self.assertEqual(self.post('policy', body={'locked': True}).status_code, 200)
        self.assertEqual(self.post('token', self.student).json()['error']['code'], 'ROOM_LOCKED')
        self.assertEqual(self.post('token').status_code, 200)
        self.post('policy', body={'locked': False}); self.connect()
        self.post('policy', body={'locked': True})
        self.assertEqual(self.connect().status_code, 200)
        self.post('leave', self.student, {'participant_sid': 'PA_current'})
        self.assertEqual(self.post('token', self.student).json()['error']['code'], 'ROOM_LOCKED')

    def test_policy_enforces_signed_track_sources_and_host_retains_share(self):
        self.live()
        self.post('policy', body={'unmute': False, 'screen_share': False})
        for actor, expected in ((self.student, ['camera']), (self.teacher, ['camera', 'microphone', 'screen_share', 'screen_share_audio'])):
            data = self.post('token', actor).json()['data']
            claims = jwt.decode(data['token'], self.provider.settings.LIVEKIT_API_SECRET, algorithms=['HS256'])
            self.assertEqual(claims['video']['canPublishSources'], expected)
        self.assertEqual(self.post('policy', self.student, {'chat': False}).status_code, 403)
        self.assertEqual(self.post('policy', self.other, {'chat': False}).status_code, 404)

    def test_provider_leave_ends_lock_exemption_but_stale_leave_does_not(self):
        self.live(); self.connect('PA_old'); self.connect('PA_new')
        self.post('policy', body={'locked': True})
        self.webhook('participant_left', 'PA_old')
        self.assertEqual(self.post('token', self.student).status_code, 200)
        self.webhook('participant_left', 'PA_new')
        self.assertEqual(self.post('token', self.student).json()['error']['code'], 'ROOM_LOCKED')

    def test_chat_cannot_bypass_host_policy_or_spoof_sender(self):
        self.live(); self.connect()
        sent = self.post('chat', self.student, {'text': 'Hello classroom', 'name': 'Forged teacher'})
        self.assertEqual(sent.status_code, 200)
        self.assertEqual(sent.json()['data']['sender'], str(self.student.id))
        self.assertEqual(sent.json()['data']['name'], self.student.full_name)
        self.assertEqual(self.provider.events[-1][0], 'classroom-chat')
        self.post('policy', body={'chat': False})
        self.assertEqual(self.post('chat', self.student, {'text': 'Blocked'}).json()['error']['code'], 'CHAT_DISABLED')
        self.assertEqual(self.post('chat', self.outsider, {'text': 'Blocked'}).status_code, 404)
        self.assertEqual(self.post('chat', self.student, {'text': 'x' * 1001}).status_code, 422)

    def test_hand_order_persists_until_lowered_by_owner_or_host(self):
        self.live(); self.connect()
        first = self.post('hand', self.student, {'raised': True}).json()['data']['raised_at']
        second = self.post('hand', self.student, {'raised': True}).json()['data']['raised_at']
        self.assertEqual(first, second)
        self.post('actions', body={'action': 'lower_hand', 'participant_id': str(self.student.id)})
        self.assertIsNone(self.provider.updated[-1]['members'][str(self.student.id)]['hand'])
        self.assertEqual(self.post('hand', self.student, {'raised': False}).status_code, 200)
        self.assertEqual(self.post('actions', self.student, {'action': 'lower_all'}).status_code, 403)

    def test_mute_and_request_unmute_are_separate_and_never_remote_unmute(self):
        self.live(); self.connect()
        self.assertEqual(self.post('actions', body={'action': 'mute_all'}).status_code, 200)
        self.assertEqual(self.provider.events[-1], ('mute', str(self.student.id)))
        self.assertEqual(self.post('actions', body={'action': 'request_unmute', 'participant_id': str(self.student.id)}).status_code, 200)
        self.assertEqual(self.provider.events[-1], ('classroom-control', {'type': 'request_unmute'}, [str(self.student.id)]))
        self.post('policy', body={'unmute': False})
        self.assertEqual(self.post('actions', body={'action': 'request_unmute', 'participant_id': str(self.student.id)}).status_code, 409)

    def test_failed_projection_is_durable_and_restricts_future_tokens(self):
        self.live()
        with patch.object(self.provider, 'metadata', AsyncMock(side_effect=HTTPException(503))):
            self.assertEqual(self.post('policy', body={'locked': True}).status_code, 503)
        item = self.db.get(LiveClass, UUID(self.id))
        self.assertTrue(item.controls_sync_pending)
        self.assertEqual(self.post('token', self.student).json()['error']['code'], 'ROOM_LOCKED')

    def test_waiting_roster_is_private_and_notifications_reuse_existing_service(self):
        self.live(); self.assertTrue(self.notifications.called)
        self.post('policy', body={'waiting_room': True}); self.post('admission', self.student)
        own = self.client.get(f'/api/v1/live-classes/{self.id}', headers=self.headers(self.student)).json()['data']
        self.assertEqual(own['waiting'], [])
        self.assertNotIn('members', own)

    def test_provider_updates_actual_grants_and_mutes_only_audio(self):
        import asyncio
        from app.services.classroom_controls import state
        real = LiveKitProvider()
        participant = api.ParticipantInfo(identity=str(self.student.id), metadata='{}', tracks=[
            api.TrackInfo(sid='TR_microphone', source=api.TrackSource.MICROPHONE),
            api.TrackInfo(sid='TR_camera', source=api.TrackSource.CAMERA)])
        self.live()
        item = self.db.get(LiveClass, UUID(self.id))
        value = state(item); value['policy']['unmute'] = False
        with patch.object(real, '_call', AsyncMock()) as remote:
            asyncio.run(real.permissions(item, participant, value))
            request = remote.call_args.args[1]
            self.assertEqual(list(request.permission.can_publish_sources), [api.TrackSource.CAMERA])
            asyncio.run(real.mute(room_name(item.id), participant))
            request = remote.call_args.args[1]
            self.assertEqual(request.track_sid, 'TR_microphone'); self.assertTrue(request.muted)


