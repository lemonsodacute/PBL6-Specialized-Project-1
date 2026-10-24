"""Explicit live AI integration checks. Uses real API calls and disposable local data.

No provider mocks, no application database writes, no key/response logging.
Run only after configuring backend/.env. Requests consume the provider's quota;
Gemini Free Tier requires a Free Tier project in Google AI Studio.
"""
import json
from pathlib import Path
import sys
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class LiveAIFeatures(unittest.TestCase):
    def test_question_docx_to_real_draft_review_and_explicit_import(self):
        from tests import test_question_documents as documents
        fixture = documents.DocumentApiTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        before = fixture.count()
        capability = fixture.client.get(fixture.base + '/document-capabilities', headers=fixture.headers())
        self.assertTrue(capability.json()['data']['generation_available'])
        response = fixture.upload(documents.docx_bytes(
            'HTML mô tả cấu trúc của trang web. CSS quy định cách trình bày, màu sắc và bố cục. '
            'JavaScript bổ sung hành vi tương tác cho trang web. Ba công nghệ này được sử dụng cùng nhau khi xây dựng giao diện web. '
            'Thẻ a tạo liên kết. Thẻ img hiển thị hình ảnh. Thuộc tính alt cung cấp văn bản thay thế cho hình ảnh. '
            'Thẻ table biểu diễn dữ liệu dạng bảng. Thẻ form chứa các trường nhập liệu.'))
        self.assertEqual(response.status_code, 200)
        session = response.json()['data']
        prepared = fixture.prepare(session['id'], 'generate', count=3, question_type='mcq_single', difficulty='easy')
        self.assertEqual(prepared.status_code, 200)
        url = fixture.base + '/documents/' + session['id']
        generated = fixture.client.post(url + '/batches/0', headers=fixture.headers())
        self.assertEqual(generated.status_code, 200, 'Real Question Generation failed; use --probe for the safe error code.')
        draft = generated.json()['data']['questions'][0]
        self.assertEqual(len(generated.json()['data']['questions']), 3)
        self.assertTrue(draft['source_excerpt'])
        self.assertTrue(draft['answers'])
        self.assertTrue(draft['explanation'])
        self.assertEqual(fixture.count(), before, 'Drafts must not auto-import')
        # Review API returns the same persisted draft, then accepts an explicit edit/import.
        review = fixture.client.get(url, headers=fixture.headers())
        self.assertEqual(review.json()['data']['questions'][0], draft)
        draft['topic'] = 'Live AI review'
        regenerated = fixture.client.post(url + '/drafts/' + draft['id'] + '/regenerate', headers=fixture.headers())
        self.assertEqual(regenerated.status_code, 200, 'Real regeneration failed')
        refreshed = fixture.client.get(url, headers=fixture.headers()).json()['data']
        self.assertEqual(refreshed['questions'][1:], generated.json()['data']['questions'][1:])
        self.assertEqual(regenerated.json()['data']['source_chunk_id'], draft['source_chunk_id'])
        draft = regenerated.json()['data']
        imported = fixture.client.post(url + '/import', headers=fixture.headers(), json={'questions': [draft]})
        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()['data']['imported_count'], 1)
        self.assertEqual(fixture.count(), before + 1)
        self.assertNotIn(self.key, generated.text + review.text + imported.text + capability.text)

    def test_support_real_kb_request_and_persisted_session(self):
        from tests import test_support_chat as transport
        fixture = transport.SupportChatTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        headers = fixture.headers(fixture.teacher)
        started = fixture.client.post('/api/v1/support-assistant/sessions', headers=headers, json={})
        self.assertEqual(started.status_code, 200)
        session = started.json()['data']; self.assertTrue(session['provider_configured'])
        path = '/api/v1/support-assistant/sessions/' + session['id']
        greeting = fixture.client.post(path + '/turns', headers=headers, json={'client_id': str(uuid4()), 'action': 'message', 'text': 'alo'})
        self.assertEqual(greeting.json()['data']['phase'], 'CATEGORY')
        self.assertFalse(greeting.json()['data']['messages'][-1]['used_provider'])
        result = fixture.client.post(path + '/turns', headers=headers, json={'client_id': str(uuid4()), 'action': 'message',
            'text': 'giám sát'})
        self.assertEqual(result.status_code, 200)
        data = result.json()['data']
        self.assertIsNone(data['ai_error'], 'Real Support provider failed; use --probe for the safe error code.')
        self.assertTrue(data['messages'][-1]['used_provider'])
        self.assertTrue(data['messages'][-1]['assistant_text'])
        self.assertIn('teacher-6', [source['id'] for source in data['messages'][-1]['sources']])
        persisted = fixture.client.get(path, headers=headers)
        self.assertEqual(persisted.json()['data']['messages'], data['messages'])
        self.assertNotIn(self.key, started.text + result.text + persisted.text)
        failed = fixture.client.post(path + '/turns', headers=headers, json={'client_id': str(uuid4()), 'action': 'unresolved'})
        self.assertEqual(failed.json()['data']['phase'], 'ESCALATE')
        escalated = fixture.client.post(path + '/turns', headers=headers, json={'client_id': str(uuid4()), 'action': 'escalate'})
        case = escalated.json()['data']; conversation_id = case['conversation_id']
        self.assertEqual(case['summary']['user_name'], fixture.teacher.full_name)
        self.assertTrue(case['summary']['articles'])
        self.assertTrue(case['summary']['confirmed_unresolved'])
        inbox = fixture.client.get('/api/v1/chat/conversations', headers=fixture.headers(fixture.admin)).json()['data']
        self.assertIn(conversation_id, [c['id'] for c in inbox])
        from app.core.security import create_access_token
        with fixture.client.websocket_connect('/api/v1/chat/ws') as ws:
            ws.send_json({'type': 'auth', 'token': create_access_token(str(fixture.teacher.id), 'teacher')})
            self.assertEqual(ws.receive_json()['type'], 'ready')
            reply = fixture.client.post('/api/v1/chat/conversations/' + conversation_id + '/messages', headers=fixture.headers(fixture.admin),
                json={'client_id': str(uuid4()), 'body': 'Tôi sẽ kiểm tra quyền giám sát của bạn.'})
            self.assertEqual(reply.status_code, 200)
            event = ws.receive_json()
            if event['type'] == 'resync': event = ws.receive_json()
            self.assertEqual(event['conversation_id'], conversation_id)
        refreshed = fixture.client.get(path, headers=headers).json()['data']
        self.assertEqual(refreshed['status'], 'ADMIN_ACTIVE')
        self.assertEqual(refreshed['conversation_id'], conversation_id)

    def test_docx_and_pdf_real_vision_grounding_and_private_attachment_import(self):
        from scripts.create_ai_review_fixture import review_docx, review_pdf
        from tests.test_document_images import DocumentImageApiTests
        from app.services import question_document_drafts as storage
        from app.services.question_generation import get_question_generation_provider
        from app.models.entities import Question
        from uuid import UUID
        fixture = DocumentImageApiTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        for extension, content in [('docx', review_docx()), ('pdf', review_pdf())]:
            uploaded = fixture.upload(content, extension)
            self.assertEqual(uploaded.status_code, 200)
            session = uploaded.json()['data']; url = fixture.base + '/documents/' + session['id']
            with storage.document_session(UUID(session['id']), fixture.bank.id, fixture.teacher.id) as state:
                sources = storage.generation_sources(state, state['chunks'])
                source = next(s for s in sources if s['images'] and s.get('question_key'))
                config = {'mode': 'generate', 'question_type': 'mcq_single', 'difficulty': 'easy', 'topic': 'Topology', 'count': 1}
                drafts = get_question_generation_provider().generate(sources=[source], requirements={source['id']: 1}, config=config, excluded=[])
                self.assertEqual(len(drafts), 1)
                draft = drafts[0]
                self.assertTrue(draft['images']); self.assertTrue(draft['explanation'])
                self.assertTrue(any('3' in answer for answer in draft['answers']), 'Vision must count the actual three PCs')
                self.assertEqual(draft['source_page'], 2 if extension == 'pdf' else None)
                self.assertLessEqual(len(draft['source_excerpt']), 600)
                self.assertNotIn('IMAGE_REQUIRES_VISION', draft.get('warning_codes', []))
                state.update(config=config, questions=drafts, batches=[])
                storage.save_session(state)
            reviewed = fixture.client.get(url, headers=fixture.headers())
            self.assertEqual(reviewed.json()['data']['questions'][0]['images'][0]['id'], draft['images'][0]['id'])
            imported = fixture.client.post(url + '/import', headers=fixture.headers(), json={'questions': drafts})
            self.assertEqual(imported.status_code, 200, 'Image draft import failed')
            row = fixture.db.get(Question, UUID(draft['id']))
            image_id = row.images_json[0]['id']
            picture = fixture.client.get(f'/api/v1/question-images/{row.id}/{image_id}', headers=fixture.headers())
            self.assertEqual(picture.status_code, 200)
            self.assertEqual(picture.headers['content-type'], 'image/png')
            # Isolate the second format from legitimate duplicate detection.
            fixture.db.delete(row); fixture.db.commit()


if __name__ == '__main__':
    import os
    if os.getenv('RUN_REAL_AI_TESTS') != '1':
        raise SystemExit('Skipped: set RUN_REAL_AI_TESTS=1 to make real provider calls.')
    import logging
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    logging.getLogger('httpx').setLevel(logging.WARNING)
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    from app.core.config import get_settings
    from app.services.ai_provider import provider_diagnostics
    diagnostics = provider_diagnostics()
    print(json.dumps(diagnostics, ensure_ascii=False, indent=2), flush=True)
    if not diagnostics['configured']:
        raise SystemExit(2)
    LiveAIFeatures.key = get_settings().QUESTION_GENERATION_API_KEY.strip()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LiveAIFeatures))
    raise SystemExit(0 if result.wasSuccessful() else 1)
