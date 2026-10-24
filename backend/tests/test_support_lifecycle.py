from unittest import TestCase
from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy import func, select
from app.models.entities import Notification, SupportMessage, SupportSession, SupportTurn, UserRole
from tests import test_support_assistant as assistant


class SupportLifecycleTests(TestCase):
    def setUp(self):
        self.f = assistant.SupportAssistantTests(); self.f.setUp(); self.addCleanup(self.f.doCleanups)
        self.client, self.db = self.f.client, self.f.db

    def test_user_close_keeps_history_and_blocks_every_new_turn(self):
        f = self.f; session = f.guided()
        old_turns = len(session['messages'])
        closed = f.data(f.act(session, 'close'))
        self.assertEqual(closed['status'], 'CLOSED')
        self.assertEqual(closed['closed_by'], str(f.student.id)); self.assertIsNotNone(closed['closed_at'])
        self.assertEqual(len(closed['messages']), old_turns + 1)
        self.assertEqual(closed['messages'][-1]['assistant_text'], 'Cuộc trò chuyện đã kết thúc.')
        self.assertEqual(closed['title'], 'Thẻ sinh viên · Sai Lớp')
        for action in ('message', 'category', 'resolved', 'escalate', 'reopen'):
            response = f.act(closed, action, text='More', value='camera')
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['error']['code'], 'SUPPORT_SESSION_CLOSED')
        repeated = f.data(f.act(closed, 'close'))
        self.assertEqual(datetime.fromisoformat(repeated['closed_at']).replace(tzinfo=timezone.utc), datetime.fromisoformat(closed['closed_at']).replace(tzinfo=timezone.utc))
        self.assertEqual(self.db.scalar(select(func.count()).select_from(SupportTurn)), old_turns + 1)
        current = f.start()
        self.assertNotEqual(current['id'], closed['id']); self.assertEqual(current['messages'], [])
        restored = self.client.get('/api/v1/support-assistant/sessions/' + closed['id'], headers=f.headers(f.student)).json()['data']
        self.assertEqual(restored['messages'], closed['messages'])

    def test_new_chat_archives_active_and_has_retry_safe_clean_context(self):
        f = self.f; old = f.guided()
        row = self.db.get(SupportSession, UUID(old['id']))
        row.summary = {'retrieved_articles': [{'id': 'old-private-context'}], 'confirmed_unresolved': True}; self.db.commit()
        key = str(uuid4())
        def start():
            return self.client.post('/api/v1/support-assistant/sessions', headers=f.headers(f.student), json={'new': True, 'client_id': key})
        first = start(); self.assertEqual(first.status_code, 200, first.text)
        fresh = first.json()['data']
        for _ in range(3):
            self.assertEqual(start().json()['data']['id'], fresh['id'])
        self.assertNotEqual(fresh['id'], old['id'])
        self.assertEqual(fresh['phase'], 'CATEGORY'); self.assertEqual(fresh['messages'], [])
        self.assertIsNone(fresh['category']); self.assertIsNone(fresh['topic']); self.assertIsNone(fresh['conversation_id'])
        self.assertEqual(fresh['summary'], {})
        self.db.expire_all()
        self.assertEqual(self.db.get(SupportSession, UUID(old['id'])).status, 'CLOSED')
        self.assertEqual(self.db.scalar(select(func.count()).select_from(SupportSession)), 2)
        self.assertEqual(f.start()['id'], fresh['id'])
        camera = f.data(f.act(fresh, 'category', value='camera'))
        self.assertEqual(camera['category'], 'camera'); self.assertEqual(camera['messages'][0]['user_text'], 'Camera / Microphone')

    def test_close_escalation_preserves_unread_and_new_escalation_uses_a_separate_thread(self):
        f = self.f; session = f.escalated(); conversation = session['conversation_id']
        reply = self.client.post(f'/api/v1/chat/conversations/{conversation}/messages', headers=f.headers(f.admin),
            json={'body': 'Unseen admin reply', 'client_id': str(uuid4())}).json()['data']
        before_notices = {n.id: n.is_read for n in self.db.scalars(select(Notification)).all()}
        closed = f.data(f.act(session, 'close'))
        self.assertEqual(closed['status'], 'CLOSED')
        self.db.expire_all()
        self.assertIsNone(self.db.get(SupportMessage, UUID(reply['id'])).read_at)
        self.assertEqual({n.id: n.is_read for n in self.db.scalars(select(Notification)).all()}, before_notices)
        self.assertEqual(self.client.get('/api/v1/chat/unread-count', headers=f.headers(f.student)).json()['data']['count'], 1)
        session_history = self.client.get('/api/v1/support-assistant/sessions', headers=f.headers(f.student)).json()['data']
        self.assertEqual(session_history[0]['unread_count'], 1)
        self.assertEqual(self.client.get('/api/v1/chat/conversations', headers=f.headers(f.admin)).json()['data'], [])
        archived = self.client.get('/api/v1/chat/conversations?filter=closed', headers=f.headers(f.admin)).json()['data']
        self.assertEqual([item['id'] for item in archived], [conversation])
        for actor in (f.student, f.admin):
            denied = self.client.post(f'/api/v1/chat/conversations/{conversation}/messages', headers=f.headers(actor), json={'body': 'No more', 'client_id': str(uuid4())})
            self.assertEqual(denied.status_code, 409)
            self.assertEqual(denied.json()['error']['code'], 'SUPPORT_SESSION_CLOSED')
        new = f.escalated()
        self.assertNotEqual(new['id'], session['id']); self.assertNotEqual(new['conversation_id'], conversation)
        history = self.client.get(f"/api/v1/chat/conversations/{new['conversation_id']}/messages", headers=f.headers(f.student)).json()['data']
        self.assertFalse(any(message['body'] == reply['body'] for message in history))
        old = self.client.get(f'/api/v1/chat/conversations/{conversation}/messages', headers=f.headers(f.student)).json()['data']
        self.assertTrue(any(message['body'] == reply['body'] for message in old))
        self.client.post(f'/api/v1/chat/conversations/{conversation}/read', headers=f.headers(f.student), json={'through_message_id': reply['id']})
        self.assertEqual(self.client.get('/api/v1/chat/unread-count', headers=f.headers(f.student)).json()['data']['count'], 0)

    def test_admin_close_broadcasts_persisted_system_message_without_reopening(self):
        f = self.f; session = f.escalated()
        closed = f.data(f.act(session, 'close', f.admin))
        self.assertEqual(closed['closed_by'], str(f.admin.id))
        messages = self.client.get(f"/api/v1/chat/conversations/{session['conversation_id']}/messages", headers=f.headers(f.student)).json()['data']
        self.assertEqual(messages[-1]['kind'], 'system')
        self.assertEqual(messages[-1]['body'], 'Quản trị viên đã đánh dấu yêu cầu hỗ trợ là đã giải quyết.')
        self.assertEqual(f.act(closed, 'reopen').json()['error']['code'], 'SUPPORT_SESSION_CLOSED')
        fresh = f.start(fresh=True)
        self.assertIsNone(fresh['conversation_id']); self.assertEqual(fresh['messages'], [])

    def test_resolved_ai_is_readonly_and_history_cursor_is_owner_scoped(self):
        f = self.f; session = f.guided(); resolved = f.data(f.act(session, 'resolved'))
        self.assertEqual(f.act(resolved, 'message', text='More').json()['error']['code'], 'SUPPORT_SESSION_CLOSED')
        fresh = f.start()
        page = self.client.get('/api/v1/support-assistant/sessions?limit=1', headers=f.headers(f.student)).json()
        self.assertEqual(page['data'][0]['id'], fresh['id']); self.assertIsNotNone(page['meta']['next_cursor'])
        older = self.client.get('/api/v1/support-assistant/sessions?cursor=' + page['meta']['next_cursor'], headers=f.headers(f.student)).json()['data']
        self.assertEqual(older[0]['id'], resolved['id']); self.assertEqual(older[0]['title'], 'Thẻ sinh viên · Sai Lớp')
        foreign = f.start(f.teacher)
        self.assertEqual(self.client.get('/api/v1/support-assistant/sessions?cursor=' + foreign['id'], headers=f.headers(f.student)).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/support-assistant/sessions', headers=f.headers(f.admin)).status_code, 403)

    def test_account_role_change_starts_clean_and_cannot_resume_a_previous_role_by_retry_key(self):
        f = self.f; key = str(uuid4())
        old = self.client.post('/api/v1/support-assistant/sessions', headers=f.headers(f.student), json={'new': True, 'client_id': key}).json()['data']
        f.data(f.act(old, 'category', value='student-card'))
        f.student.role = UserRole.teacher; f.student.student_code = None; self.db.commit()
        self.assertEqual(self.client.post('/api/v1/support-assistant/sessions', headers=f.headers(f.student), json={'new': True, 'client_id': key}).status_code, 409)
        fresh = f.start()
        self.assertNotEqual(fresh['id'], old['id']); self.assertEqual(fresh['messages'], [])
        self.assertIsNone(fresh['category']); self.assertTrue(any(category['id'] == 'monitoring' for category in fresh['categories']))
        self.assertEqual(self.client.get('/api/v1/support-assistant/sessions/' + old['id'], headers=f.headers(f.student)).status_code, 404)
