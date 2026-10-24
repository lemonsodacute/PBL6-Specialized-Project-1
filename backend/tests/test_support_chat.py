from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect
from app.core.security import create_access_token, create_refresh_token
from app.models.entities import Notification, SupportConversation, SupportMessage, SupportSession, SupportTurn, User, UserRole
from tests import test_teacher_results as fixtures


class SupportChatTests(TestCase):
    def setUp(self):
        fixtures.TeacherResultsTests.setUp(self)
        for model in (SupportConversation, SupportMessage, SupportSession, SupportTurn, Notification): model.__table__.create(self.db.bind)
        from app.models.entities import SupportArticle, AIActivity, AIDraftReview
        from app.services.support_knowledge import seed
        for model in (SupportArticle, AIActivity, AIDraftReview): model.__table__.create(self.db.bind)
        seed(self.db)
        # The production socket dependency and REST use the same overridden DB.
        self.admin2 = User(id=uuid4(), full_name='Another Admin', email=f'{uuid4()}@example.test',
                           password_hash='unused', role=UserRole.admin, is_active=True)
        self.db.add(self.admin2); self.db.commit()

    headers = fixtures.TeacherResultsTests.headers
    attempt = fixtures.TeacherResultsTests.attempt

    def open(self, actor):
        # Transport tests start with an already escalated case. Assistant lifecycle
        # and the legacy endpoint gate have separate acceptance tests.
        row = self.db.scalar(select(SupportConversation).where(SupportConversation.owner_id == actor.id))
        if not row:
            row = SupportConversation(id=uuid4(), owner_id=actor.id); self.db.add(row); self.db.flush()
            self.db.add(SupportSession(id=uuid4(), user_id=actor.id, role=actor.role.value,
                status='ESCALATED', phase='ESCALATE', conversation_id=row.id, summary={}))
            self.db.commit()
        response = self.client.post('/api/v1/chat/support', headers=self.headers(actor))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']['id']

    def send(self, actor, conversation, text='Support message', key=None):
        return self.client.post(f'/api/v1/chat/conversations/{conversation}/messages',
            headers=self.headers(actor), json={'body': text, 'client_id': str(key or uuid4())})

    def get(self, actor, path):
        return self.client.get('/api/v1/chat' + path, headers=self.headers(actor))

    def test_separate_threads_persistence_actual_sender_and_shared_admin_unread(self):
        student = self.open(self.student); teacher = self.open(self.teacher)
        self.assertEqual(self.open(self.student), student)
        self.assertNotEqual(student, teacher)
        self.assertEqual(self.get(self.admin, '/conversations').json()['data'], [])
        sent = self.send(self.student, student, '  Cannot verify card  ')
        self.assertEqual(sent.status_code, 200, sent.text)
        message = sent.json()['data']; self.assertEqual(message['body'], 'Cannot verify card')
        self.assertEqual(message['sender_id'], str(self.student.id))
        self.assertEqual(self.send(self.teacher, teacher).status_code, 200)
        self.assertEqual(len(self.get(self.admin, '/conversations').json()['data']), 2)
        self.assertEqual(self.get(self.admin2, '/unread-count').json()['data']['count'], 2)
        reply = self.send(self.admin2, student, 'Please try again').json()['data']
        self.assertEqual(reply['sender_id'], str(self.admin2.id))
        self.assertEqual(self.get(self.student, '/unread-count').json()['data']['count'], 1)
        self.assertEqual(self.get(self.student, f'/conversations/{student}/messages').json()['data'][-1]['body'], 'Please try again')
        read = self.client.post(f'/api/v1/chat/conversations/{student}/read', headers=self.headers(self.admin),
                               json={'through_message_id': message['id']})
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(self.get(self.admin2, '/unread-count').json()['data']['count'], 1)
        self.assertEqual(self.get(self.student, '/unread-count').json()['data']['count'], 1)

    def test_idor_all_operations_and_spoofing(self):
        target = self.open(self.teacher)
        msg = self.send(self.teacher, target).json()['data']
        for actor in (self.student, self.other):
            self.assertEqual(self.get(actor, f'/conversations/{target}').status_code, 404)
            self.assertEqual(self.get(actor, f'/conversations/{target}/messages').status_code, 404)
            self.assertEqual(self.send(actor, target).status_code, 404)
            self.assertEqual(self.client.post(f'/api/v1/chat/conversations/{target}/read', headers=self.headers(actor),
                json={'through_message_id': msg['id']}).status_code, 404)
        self.assertEqual(self.client.post('/api/v1/chat/support', headers=self.headers(self.admin)).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/chat/conversations').status_code, 401)
        self.assertEqual(self.client.post(f'/api/v1/chat/conversations/{target}/messages', headers=self.headers(self.teacher),
            json={'body':'Spoof', 'client_id':str(uuid4()), 'sender_id':str(self.admin.id)}).status_code, 422)

    def test_validation_idempotent_retry_notifications_and_read_watermark(self):
        convo = self.open(self.student)
        for body in ('', '  \n ', 'x' * 4001, 'abc\x00'):
            self.assertEqual(self.send(self.student, convo, body).status_code, 422)
        key = uuid4()
        first = self.send(self.student, convo, '<script>alert(1)</script>', key)
        self.assertEqual(first.status_code, 200, first.text)
        second = self.send(self.student, convo, '<script>alert(1)</script>', key)
        self.assertEqual(first.json()['data']['id'], second.json()['data']['id'])
        self.assertEqual(len(self.db.scalars(select(Notification)).all()), 2)
        self.assertEqual(self.send(self.student, convo, 'Different text', key).status_code, 409)
        # Same-clock-tick sends must not mark a later notification read early.
        with patch('app.api.v1.chat.datetime') as clock:
            clock.now.return_value = datetime.fromisoformat(first.json()['data']['created_at']).replace(tzinfo=timezone.utc)
            later = self.send(self.student, convo, 'Later message').json()['data']
        self.client.post(f'/api/v1/chat/conversations/{convo}/read', headers=self.headers(self.admin),
                         json={'through_message_id': first.json()['data']['id']})
        self.assertEqual(self.get(self.admin, '/unread-count').json()['data']['count'], 1)
        notices = self.db.scalars(select(Notification).where(Notification.recipient_user_id == self.admin.id)).all()
        self.assertEqual(sum(not notice.is_read for notice in notices), 1)
        self.assertEqual(self.get(self.student, f'/conversations/{convo}/messages').json()['data'][-1]['id'], later['id'])

    def test_cursor_history_search_filters_no_cross_conversation_cursor(self):
        convo = self.open(self.student); other = self.open(self.teacher)
        for index in range(45): self.assertEqual(self.send(self.student, convo, f'Message {index}').status_code, 200)
        other_msg = self.send(self.teacher, other).json()['data']
        latest = self.get(self.student, f'/conversations/{convo}/messages').json()
        self.assertEqual(len(latest['data']), 40)
        older = self.get(self.student, f'/conversations/{convo}/messages?before={latest["meta"]["next_cursor"]}').json()
        self.assertEqual(len(older['data']), 5); self.assertIsNone(older['meta']['next_cursor'])
        self.assertEqual(older['data'][0]['body'], 'Message 0')
        self.assertEqual(self.get(self.student, f'/conversations/{convo}/messages?before={other_msg["id"]}').status_code, 400)
        rows = self.get(self.admin, '/conversations?q=realcode01&filter=student').json()['data']
        self.assertEqual([row['id'] for row in rows], [convo])
        page = self.get(self.admin, '/conversations?limit=1').json()
        next_page = self.get(self.admin, f'/conversations?limit=1&cursor={page["meta"]["next_cursor"]}').json()
        self.assertNotEqual(page['data'][0]['id'], next_page['data'][0]['id'])

    def test_exam_guard_and_disabled_account(self):
        convo = self.open(self.active)
        self.assertEqual(self.send(self.active, convo).status_code, 403)
        self.progress.server_deadline_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.db.commit()
        self.assertEqual(self.send(self.active, convo).status_code, 200)
        self.active.is_active = False; self.db.commit()
        self.assertEqual(self.send(self.active, convo).status_code, 401)

    def test_socket_auth_invalid_token_origin_subscription_and_scoped_delivery(self):
        student = self.open(self.student); teacher = self.open(self.teacher)
        # TestClient opens sockets on separate portal loops; broadcasts contain IDs only.
        for token in ('bad-token', create_refresh_token(str(self.student.id))):
            with self.assertRaises(WebSocketDisconnect):
                with self.client.websocket_connect('/api/v1/chat/ws') as ws:
                    ws.send_json({'type': 'auth', 'token': token}); ws.receive_json()
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/api/v1/chat/ws', headers={'origin':'https://untrusted.example'}) as ws:
                ws.receive_json()
        token = create_access_token(str(self.student.id), 'admin')  # DB role wins.
        with self.client.websocket_connect('/api/v1/chat/ws') as ws:
            ws.send_json({'type':'auth', 'token':token, 'user_id':str(self.teacher.id)})
            self.assertEqual(ws.receive_json()['type'], 'ready')
            sent = self.send(self.admin, student, 'Student only')
            self.assertEqual(sent.status_code, 200, sent.text)
            event = ws.receive_json()
            if event['type'] == 'resync': event = ws.receive_json()
            self.assertEqual(event.get('conversation_id'), student, event)
            ws.send_text('ping'); self.assertEqual(ws.receive_json()['type'], 'ping')
            ws.send_json({'type':'subscribe', 'conversation_id':teacher})
            with self.assertRaises(WebSocketDisconnect): ws.receive_json()
