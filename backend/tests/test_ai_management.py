"""Isolated DB acceptance fixtures, never reported as real teacher evaluations."""
import csv
from io import StringIO
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from sqlalchemy import select
from app.models.entities import AIActivity, AIDraftReview, AuditLog, User, UserRole
from app.services import support_knowledge as kb
from app.services.ai_provider import ai_trace
from app.services.question_document_extract import DocumentError
from tests import test_question_documents as docs
from tests import test_support_assistant as support


class ManagementTests(TestCase):
    def setUp(self):
        self.fixture = support.SupportAssistantTests(); self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.client = self.fixture.client; self.db = self.fixture.db; self.headers = self.fixture.headers(self.fixture.admin)

    def test_kb_edit_deactivate_role_scope_secret_rejection_and_metadata_audit(self):
        path = '/api/v1/admin/ai-support/articles'
        self.assertEqual(self.client.get(path, headers=self.fixture.headers(self.fixture.student)).status_code, 403)
        body = {'title': 'Kiểm tra kết nối thử nghiệm', 'role': 'teacher', 'category': 'monitoring',
            'content': 'Mở trang giám sát và kiểm tra trạng thái kết nối.', 'keywords': ['monitorprobe'], 'route': '', 'is_active': True}
        created = self.client.post(path, json=body, headers=self.headers)
        self.assertEqual(created.status_code, 200, created.text); article_id = created.json()['data']['id']
        self.assertEqual(kb.retrieve('teacher', 'monitoring', 'monitorprobe', db=self.db)[0]['id'], article_id)
        self.assertEqual(kb.retrieve('student', 'monitoring', 'monitorprobe', db=self.db), [])
        body['content'] = 'Nội dung mới: kiểm tra kết nối và tải lại trang giám sát.'
        self.assertEqual(self.client.put(path + '/' + article_id, json=body, headers=self.headers).status_code, 200)
        self.assertIn('Nội dung mới', kb.retrieve('teacher', 'monitoring', 'monitorprobe', db=self.db)[0]['steps'][0])
        body['is_active'] = False
        self.assertEqual(self.client.put(path + '/' + article_id, json=body, headers=self.headers).status_code, 200)
        self.assertEqual(kb.retrieve('teacher', 'monitoring', 'monitorprobe', db=self.db), [])
        body['content'] = 'API key: sk-test-secret-value-12345'
        rejected = self.client.post(path, json=body, headers=self.headers)
        self.assertEqual(rejected.status_code, 422); self.assertNotIn('sk-test-secret', rejected.text)
        logs = self.db.scalars(select(AuditLog).where(AuditLog.action.like('SUPPORT_ARTICLE_%'))).all()
        self.assertEqual(len(logs), 3)
        self.assertNotIn('content', str([r.metadata_json for r in logs]))

    def test_six_resolved_four_escalated_from_actual_session_actions_and_csv(self):
        f = self.fixture
        for _ in range(6):
            f.start(f.teacher, fresh=True)
            session = f.guided(f.teacher)
            f.data(f.act(session, 'resolved', f.teacher))
        for _ in range(4):
            user = User(id=uuid4(), full_name='Evaluation actor', email=f'{uuid4()}@example.test', password_hash='unused', role=UserRole.teacher, is_active=True)
            self.db.add(user); self.db.commit()
            f.escalated(user)
        result = self.client.get('/api/v1/admin/ai-support/activity', headers=self.headers)
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()['data']['support']
        self.assertEqual((data['sessions'], data['resolved_by_ai_count'], data['escalated_count']), (10, 6, 4))
        self.assertEqual(data['escalation_rate']['rate'], .4)
        exported = self.client.get('/api/v1/admin/ai-support/export/support', headers=self.headers)
        rows = list(csv.DictReader(StringIO(exported.text.lstrip('\ufeff'))))
        self.assertEqual(len(rows), 10); self.assertEqual(sum(r['resolved_by_ai'] == 'True' for r in rows), 6)
        self.assertEqual(sum(r['escalated'] == 'True' for r in rows), 4)
        self.assertNotIn('assistant_text', exported.text); self.assertNotIn('Evaluation actor', exported.text)

    def test_empty_state_date_validation_and_dev_debug_permissions(self):
        result = self.client.get('/api/v1/admin/ai-support/activity', headers=self.headers).json()['data']
        self.assertEqual(result['question']['requests'], 0)
        self.assertIsNone(result['question']['acceptance_rate']['rate'])
        self.assertIsNone(result['question']['average_teacher_rating'])
        self.assertEqual(result['question']['teacher_rating_count'], 0)
        self.assertIsNone(result['health']['cost'])
        self.assertEqual(self.client.get('/api/v1/admin/ai-support/activity?start=2026-10-17&end=2026-01-01', headers=self.headers).status_code, 422)
        with patch('app.api.v1.ai_management.get_settings', return_value=SimpleNamespace(ENVIRONMENT='production')):
            self.assertEqual(self.client.post('/api/v1/admin/ai-support/retrieval-debug', headers=self.headers,
                json={'role': 'teacher', 'query': 'giám sát'}).status_code, 404)


class ReviewMetricsTests(TestCase):
    def setUp(self):
        self.fixture = docs.DocumentApiTests(); self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.db = self.fixture.db; self.client = self.fixture.client
        from app.models.entities import SupportTurn
        SupportTurn.__table__.create(self.db.bind)

    def generate(self, fail=False):
        def run(*, sources, requirements, config, excluded):
            ai_trace('provider_request', attempt=1)
            ai_trace('provider_response', http_status=503 if fail else 200)
            if fail:
                ai_trace('provider_error', http_status=503, error_code='AI_PROVIDER_UNAVAILABLE')
                raise DocumentError('AI_PROVIDER_UNAVAILABLE', 'Dịch vụ AI đang tạm thời không khả dụng.')
            ai_trace('question_parse', parse_success=True)
            output = [{'content': f'Question {uuid4()}', 'options': ['One', 'Two'], 'answers': ['One'], 'explanation': 'Review required',
                'source_chunk_id': s['id'], 'source_excerpt': s['text'][:60], 'image_ids': []} for s in sources for _ in range(requirements[s['id']])]
            return docs.validate_generated(docs.GeneratedBatch.model_validate({'questions': output}), sources=sources, requirements=requirements, config=config, excluded=excluded)
        return SimpleNamespace(generate=run)

    def test_rating_reason_and_decision_save_independently_and_average_uses_only_real_ratings(self):
        f = self.fixture; document = f.document(); path = f.base + '/documents/' + document['id']
        with patch('app.api.v1.question_documents.generation_available', return_value=True), patch('app.api.v1.question_documents.get_question_generation_provider', return_value=self.generate()):
            f.prepare(document['id'], 'generate', count=5)
            self.assertEqual(self.client.post(path + '/batches/0', headers=f.headers()).status_code, 200)
        drafts = self.client.get(path, headers=f.headers()).json()['data']['questions']
        url = path + '/drafts/' + drafts[0]['id'] + '/feedback'
        first = self.client.put(url, headers=f.headers(), json={'quality_rating': 5})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertIsNone(first.json()['data']['decision'])
        self.assertEqual(first.json()['data']['quality_rating'], 5)
        self.assertEqual(self.client.put(url, headers=f.headers(), json={'decision': 'accepted'}).status_code, 200)
        rated = self.client.put(url, headers=f.headers(), json={'quality_rating': 1}).json()['data']
        self.assertEqual(rated['decision'], 'accepted')
        self.assertEqual(self.client.put(url, headers=f.headers(), json={'reason': 'other'}).status_code, 200)
        note = self.client.put(url, headers=f.headers(), json={'reason_note': '  Cần làm rõ thuật ngữ.  '})
        self.assertEqual(note.status_code, 200, note.text)
        restored = self.client.get(path + '/feedback', headers=f.headers()).json()['data'][drafts[0]['id']]
        self.assertEqual(restored, {'decision': 'accepted', 'quality_rating': 1, 'reason': 'other', 'reason_note': 'Cần làm rõ thuật ngữ.'})
        changed = self.client.put(url, headers=f.headers(), json={'reason': 'weak_explanation'}).json()['data']
        self.assertIsNone(changed['reason_note']); self.assertEqual(changed['quality_rating'], 1)
        self.assertEqual(self.client.put(url, headers=f.headers(), json={'reason': 'wording'}).status_code, 200)
        for draft, rating in zip(drafts[1:3], [5, 4]):
            response = self.client.put(path + '/drafts/' + draft['id'] + '/feedback', headers=f.headers(), json={'quality_rating': rating})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIsNone(response.json()['data']['decision'])
        question = self.client.get('/api/v1/admin/ai-support/activity', headers=f.headers(f.admin)).json()['data']['question']
        self.assertEqual(question['average_teacher_rating'], 3.33)
        self.assertEqual(question['teacher_rating_count'], 3)
        self.assertEqual(question['reviewed'], 1)
        self.assertEqual(question['accepted'], 1); self.assertEqual(question['rejected'], 0)
        for rating in [0, 6, -1, 1.5, '4', True]:
            self.assertEqual(self.client.put(url, headers=f.headers(), json={'quality_rating': rating}).status_code, 422)
        for body in [{}, {'reason': 'unknown'}, {'reason_note': 'x' * 2001}, {'reason_note': 'Note outside Other'}]:
            self.assertEqual(self.client.put(url, headers=f.headers(), json=body).status_code, 422)
        self.assertEqual(self.client.put(url, headers=f.headers(f.other), json={'quality_rating': 4}).status_code, 404)
        saved = self.client.get(path + '/feedback', headers=f.headers()).json()['data'][drafts[0]['id']]
        self.assertEqual(saved['quality_rating'], 1); self.assertEqual(saved['decision'], 'accepted')

    def test_ten_reviews_7_2_1_persist_and_export_without_inferred_labels(self):
        f = self.fixture; document = f.document(); path = f.base + '/documents/' + document['id']
        with patch('app.api.v1.question_documents.generation_available', return_value=True), patch('app.api.v1.question_documents.get_question_generation_provider', return_value=self.generate()):
            self.assertEqual(f.prepare(document['id'], 'generate', count=10).status_code, 200)
            for index in (0, 1): self.assertEqual(self.client.post(path + f'/batches/{index}', headers=f.headers()).status_code, 200)
        rows = self.client.get(path, headers=f.headers()).json()['data']['questions']
        for draft, decision in zip(rows, ['accepted'] * 7 + ['edited'] * 2 + ['rejected']):
            url = path + '/drafts/' + draft['id'] + '/feedback'
            response = self.client.put(url, headers=f.headers(), json={'decision': decision})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.client.put(url, headers=f.headers(f.other), json={'decision': decision}).status_code, 404)
        admin_headers = f.headers(f.admin)
        result = self.client.get('/api/v1/admin/ai-support/activity', headers=admin_headers)
        # This fixture has no SupportTurn table; added below so aggregation remains shared.
        self.assertEqual(result.status_code, 200, result.text)
        question = result.json()['data']['question']
        self.assertEqual([question[k] for k in ('reviewed', 'accepted', 'edited', 'rejected')], [10, 7, 2, 1])
        self.assertEqual(question['acceptance_rate']['rate'], .7)
        exported = self.client.get('/api/v1/admin/ai-support/export/question', headers=admin_headers)
        csv_rows = list(csv.DictReader(StringIO(exported.text.lstrip('\ufeff'))))
        self.assertEqual(sum(int(r['accepted']) for r in csv_rows), 7)
        self.assertNotIn('source_excerpt', exported.text)

    def test_503_is_persisted_without_discarding_successful_drafts(self):
        f = self.fixture; document = f.document(); path = f.base + '/documents/' + document['id']
        with patch('app.api.v1.question_documents.generation_available', return_value=True), patch('app.api.v1.question_documents.get_question_generation_provider', return_value=self.generate()):
            f.prepare(document['id'], 'generate', count=6)
            self.assertEqual(self.client.post(path + '/batches/0', headers=f.headers()).status_code, 200)
        with patch('app.api.v1.question_documents.get_question_generation_provider', return_value=self.generate(fail=True)):
            self.assertEqual(self.client.post(path + '/batches/1', headers=f.headers()).status_code, 503)
        saved = self.client.get(path, headers=f.headers()).json()['data']
        self.assertEqual(len(saved['questions']), 5)
        events = self.db.scalars(select(AIActivity)).all()
        self.assertEqual(len(events), 2)
        self.assertEqual(sum(e.metrics['provider_failure_count'] for e in events), 1)
        self.assertFalse(events[-1].metrics['success'])
