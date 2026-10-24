"""Offline HTTP contracts; these do not claim live Gemini access."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

import httpx

from app.services import question_document_drafts as storage
from app.services.ai_provider import response_error
from app.services.question_document_extract import DocumentError, extract_document
from app.services.question_generation import OpenAICompatibleQuestionProvider
from app.services.support_assistant_provider import OpenAICompatibleSupportProvider, SupportProviderUnavailable
from tests.test_ai_provider import configured, answer
from tests.test_document_images import image_docx


class GeminiContracts(TestCase):
    def test_rejected_image_falls_back_once_to_text_and_preserves_source_image_warning(self):
        settings = configured()
        settings.QUESTION_GENERATION_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
        with TemporaryDirectory() as root, patch.object(storage, 'DOCUMENT_ROOT', Path(root)):
            session = storage.new_session(uuid4(), uuid4(), 'course.docx', extract_document(image_docx(), 'docx'))
            source = next(s for s in storage.generation_sources(session, session['chunks']) if s['images'])
            output = {'content': 'Nội dung văn bản đề cập đến điều gì?', 'options': ['Mạng máy tính', 'Văn học'],
                      'answers': ['Mạng máy tính'], 'explanation': 'Dựa trên phần văn bản.',
                      'source_chunk_id': source['id'], 'source_excerpt': source['text'][:100], 'image_ids': []}
            for failure, expected in [({'status': 'INVALID_ARGUMENT', 'message': 'Unable to process input image'}, None),
                    ({'code': 'invalid_api_key'}, 'AI_AUTH_FAILED'), ({'code': 'model_not_found'}, 'AI_MODEL_UNSUPPORTED')]:
                calls = []
                def handle(request):
                    payload = json.loads(request.content); calls.append(payload)
                    self.assertNotIn('store', payload)
                    if len(calls) == 1:
                        self.assertIn('data:image/png;base64,', json.dumps(payload))
                        return httpx.Response(400, json={'error': failure})
                    self.assertIsInstance(payload['messages'][1]['content'], str)
                    self.assertNotIn('data:image', json.dumps(payload))
                    self.assertIn('No images are available', payload['messages'][0]['content'])
                    return answer(json.dumps({'questions': [output]}))
                client_class = httpx.Client
                with patch('app.services.ai_provider.httpx.Client', side_effect=lambda **kw: client_class(transport=httpx.MockTransport(handle), **kw)):
                    provider = OpenAICompatibleQuestionProvider(settings)
                    kwargs = dict(sources=[source], requirements={source['id']: 1}, config={'question_type': 'mcq_single', 'difficulty': 'medium'}, excluded=[])
                    if expected:
                        with self.assertRaises(DocumentError) as error:
                            provider.generate(**kwargs)
                        self.assertEqual(error.exception.code, expected)
                        self.assertEqual(len(calls), 1)
                    else:
                        drafts = provider.generate(**kwargs)
                        self.assertEqual(len(calls), 2)
                        self.assertEqual(drafts[0]['warning_codes'], ['IMAGE_REQUIRES_VISION'])
                        self.assertEqual(drafts[0]['images'][0]['id'], source['images'][0]['id'])

    def test_support_outbound_data_is_allowlisted_and_redacted(self):
        secrets = ['learner@example.com', 'SV123456', 'AIza' + 'x' * 35, 'postgresql://user:pass@host/db', 'private-access-token']
        query = f'Camera lỗi email {secrets[0]} MSSV: {secrets[1]} {secrets[2]} {secrets[3]} Bearer {secrets[4]}'
        article = {'id': 'camera', 'title': 'Camera', 'steps': ['Cho phép quyền camera'], 'requires_admin': False,
                   'student_answers': 'forbidden-data', 'embedding': 'forbidden-data', 'raw_card_image': 'forbidden-data'}
        def complete(**kwargs):
            payload = json.dumps(kwargs['messages'], ensure_ascii=False)
            for value in secrets + ['forbidden-data', 'student_answers', 'raw_card_image', 'embedding']:
                self.assertNotIn(value, payload)
            self.assertEqual(kwargs['feature'], 'support')
            return '{"article_ids":["camera"],"needs_admin":false}'
        with patch('app.services.support_assistant_provider.get_settings', return_value=configured()), patch('app.services.ai_provider.OpenAICompatibleClient.complete', side_effect=complete):
            selected = OpenAICompatibleSupportProvider().answer(role='student', category='camera', query=query, sources=[article])
        self.assertEqual(selected.article_ids, ['camera'])

    def test_support_invalid_schema_is_distinct_from_configuration_and_quota(self):
        with patch('app.services.support_assistant_provider.get_settings', return_value=configured()), patch('app.services.ai_provider.OpenAICompatibleClient.complete', return_value='{}'):
            with self.assertRaises(SupportProviderUnavailable) as error:
                OpenAICompatibleSupportProvider().answer(role='student', category='camera', query='Camera lỗi', sources=[])
        self.assertEqual(error.exception.code, 'AI_INVALID_RESPONSE')
        self.assertEqual(SupportProviderUnavailable('AI_RATE_LIMITED').message, 'Đã đạt giới hạn AI tạm thời. Vui lòng thử lại sau.')

    def test_ambiguous_request_errors_never_trigger_vision_fallback(self):
        for status, body in [(400, {'status': 'INVALID_ARGUMENT', 'message': 'bad schema'}),
                             (429, {'status': 'RESOURCE_EXHAUSTED'}), (503, {'status': 'UNAVAILABLE'})]:
            self.assertIsNone(response_error(httpx.Response(status, json={'error': body})).capability)

    def test_question_text_redacts_identifiers_without_losing_grounded_draft(self):
        fact = 'HTML describes the structure of a webpage.'
        source = {'id': 'chunk-1', 'page': 1, 'label': 'Course', 'text': fact + ' Email student@example.com MSSV SV123456'}
        output = {'content': 'What does HTML describe?', 'options': ['Structure', 'Styling'], 'answers': ['Structure'],
                  'explanation': fact, 'source_chunk_id': 'chunk-1', 'source_excerpt': fact, 'image_ids': []}
        def complete(**kwargs):
            payload = json.dumps(kwargs['messages'])
            self.assertNotIn('student@example.com', payload)
            self.assertNotIn('SV123456', payload)
            return json.dumps({'questions': [output]})
        with patch('app.services.ai_provider.OpenAICompatibleClient.complete', side_effect=complete):
            drafts = OpenAICompatibleQuestionProvider(configured()).generate(sources=[source], requirements={'chunk-1': 1},
                config={'question_type': 'mcq_single', 'difficulty': 'easy'}, excluded=[])
        self.assertEqual(drafts[0]['source_excerpt'], fact)
