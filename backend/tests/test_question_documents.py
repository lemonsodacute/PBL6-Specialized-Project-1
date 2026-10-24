"""Real parser/API integration, private ownership, atomic import and provider contracts."""
from collections import Counter
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

from docx import Document
import httpx
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app.models.entities import Question
from app.schemas.question_documents import DraftQuestion, ImportDrafts
from app.services import question_document_drafts as storage
from app.services.question_document_extract import DocumentError, MIME_TYPES, MAX_FILE_BYTES, extract_document, chunk_sections
from app.services.question_generation import GeneratedBatch, OpenAICompatibleQuestionProvider, validate_generated
from tests import test_question_selection as selection_fixture


TEXT = 'Câu 1: HTML dùng để làm gì?\nA. Cấu trúc trang web\nB. Trang trí trang web\nĐáp án: A\nGiải thích: HTML mô tả cấu trúc.\nCâu 2: CSS dùng để làm gì?\nA. Cấu trúc\nB. Trang trí\nĐáp án: B'


def docx_bytes(text=TEXT):
    document = Document()
    document.add_paragraph(text)
    output = BytesIO(); document.save(output)
    return output.getvalue()


def pdf_bytes(text=None, encrypted=False):
    writer = PdfWriter(); page = writer.add_blank_page(width=612, height=792)
    if text:
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        lines = [line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)') for line in text.splitlines()]
        stream.set_data(('BT /F1 12 Tf 40 740 Td 16 TL ' + ' T* '.join(f'({line}) Tj' for line in lines) + ' ET').encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(stream)
    if encrypted:
        writer.encrypt('test-password')
    output = BytesIO(); writer.write(output)
    return output.getvalue()


class DocumentApiTests(TestCase):
    headers = selection_fixture.QuestionSelectionTests.headers

    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.object(storage, 'DOCUMENT_ROOT', Path(directory)))
        selection_fixture.QuestionSelectionTests.setUp(self)
        from app.models.entities import SupportConversation, SupportSession, AIActivity, AIDraftReview, AuditLog
        for model in (SupportConversation, SupportSession, AIActivity, AIDraftReview, AuditLog): model.__table__.create(self.db.bind, checkfirst=True)
        self.base = f'/api/v1/question-banks/{self.bank.id}'

    def upload(self, content=None, extension='docx', actor=None, bank=None, mime=None):
        return self.client.post(f'/api/v1/question-banks/{(bank or self.bank).id}/documents',
            files={'document': (f'questions.{extension}', content if content is not None else docx_bytes(), mime or MIME_TYPES.get(extension, 'text/plain'))}, headers=self.headers(actor))

    def prepare(self, document_id, mode='import', **kwargs):
        return self.client.post(f'{self.base}/documents/{document_id}/drafts', json={'mode': mode, **kwargs}, headers=self.headers())

    def document(self):
        response = self.upload(); self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def import_payload(self, document):
        response = self.prepare(document['id']); self.assertEqual(response.status_code, 200, response.text)
        return {'questions': response.json()['data']['questions']}

    def count(self):
        return self.db.scalar(select(func.count()).select_from(Question))

    def test_real_docx_preview_review_only_atomic_import_and_idempotent_retry(self):
        before = self.count(); document = self.document()
        self.assertIn('HTML dùng', document['sections'][0]['text'])
        self.assertIsNone(document['sections'][0]['page'])
        self.assertEqual(self.count(), before)
        payload = self.import_payload(document)
        self.assertEqual(len(payload['questions']), 2)
        self.assertEqual(payload['questions'][0]['answers'], ['Cấu trúc trang web'])
        self.assertEqual(self.count(), before)
        # Teacher edits are persisted only by the explicit import endpoint.
        payload['questions'][0].update(content='HTML mô tả thành phần nào?', difficulty='hard', topic='Web', default_points='2.50')
        url = f"{self.base}/documents/{document['id']}/import"
        result = self.client.post(url, json=payload, headers=self.headers())
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['data']['imported_count'], 2)
        self.assertEqual(self.count(), before + 2)
        row = self.db.scalar(select(Question).where(Question.content == 'HTML mô tả thành phần nào?'))
        self.assertEqual(row.correct_answer_json, {'answer': 'Cấu trúc trang web'})
        self.assertEqual(str(row.default_points), '2.50')
        self.assertEqual(row.topic, 'Web')
        retry = self.client.post(url, json=payload, headers=self.headers())
        self.assertEqual(retry.json(), result.json()); self.assertEqual(self.count(), before + 2)
        state = json.loads((storage.DOCUMENT_ROOT / f"{document['id']}.json").read_text(encoding='utf-8'))
        self.assertEqual(state['sections'], []); self.assertEqual(state['chunks'], []); self.assertEqual(state['questions'], [])
        changed = json.loads(json.dumps(payload)); changed['questions'][0]['content'] = 'Changed after import'
        self.assertEqual(self.client.post(url, json=changed, headers=self.headers()).status_code, 409)

    def test_real_pdf_text_layer_scan_and_encryption(self):
        response = self.upload(pdf_bytes('Question 1: What does HTML describe?\nA. Structure\nB. Styling\nAnswer: A'), 'pdf')
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()['data']; self.assertEqual(session['sections'][0]['page'], 1)
        draft = self.prepare(session['id']).json()['data']['questions'][0]
        self.assertEqual(draft['answers'], ['Structure']); self.assertEqual(draft['source_page'], 1)
        for content, code in [(pdf_bytes(), 'DOCUMENT_HAS_NO_TEXT'), (pdf_bytes(encrypted=True), 'ENCRYPTED_DOCUMENT')]:
            result = self.upload(content, 'pdf')
            self.assertEqual(result.status_code, 422, result.text); self.assertEqual(result.json()['error']['code'], code)

    def test_file_validation_corruption_macro_and_size(self):
        for content, extension, mime, status in [(b'junk', 'pdf', None, 422), (b'junk', 'docx', None, 422), (b'abc', 'txt', None, 422), (docx_bytes(), 'docx', 'application/pdf', 422), (b'x' * (MAX_FILE_BYTES + 1), 'pdf', None, 413)]:
            self.assertEqual(self.upload(content, extension, mime=mime).status_code, status)
        buffer = BytesIO(docx_bytes())
        with ZipFile(buffer, 'a') as archive:
            archive.writestr('word/vbaProject.bin', b'not-executed')
        self.assertEqual(self.upload(buffer.getvalue()).status_code, 422)
        self.assertEqual(list(storage.DOCUMENT_ROOT.glob('*.json')), [])

    def test_permissions_private_cache_no_paths_expiry_and_discard(self):
        self.assertEqual(self.upload(actor=self.student).status_code, 403)
        self.assertEqual(self.upload(actor=self.other).status_code, 404)
        self.assertEqual(self.upload(bank=self.other_bank).status_code, 404)
        document = self.document(); url = f"{self.base}/documents/{document['id']}"
        response = self.client.get(url, headers=self.headers())
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertNotIn('user_id', response.json()['data']); self.assertNotIn('bank_id', response.json()['data'])
        self.assertNotIn(str(storage.DOCUMENT_ROOT), response.text)
        self.assertEqual(self.client.get(url, headers=self.headers(self.other)).status_code, 404)
        # Even an admin cannot read another user's private document session.
        self.assertEqual(self.client.get(url, headers=self.headers(self.admin)).status_code, 404)
        self.assertEqual(self.client.get(f"/uploads/question-documents/{document['id']}.json").status_code, 404)
        path = storage.DOCUMENT_ROOT / f"{document['id']}.json"
        state = json.loads(path.read_text(encoding='utf-8')); state['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(); storage.save_session(state)
        self.assertIn(self.client.get(url, headers=self.headers()).status_code, [404, 410]); self.assertFalse(path.exists())
        second = self.document()
        self.assertEqual(self.client.delete(f"{self.base}/documents/{second['id']}", headers=self.headers()).status_code, 200)
        self.assertFalse((storage.DOCUMENT_ROOT / f"{second['id']}.json").exists())

    def test_duplicate_invalid_answer_and_foreign_draft_do_not_partially_write(self):
        document = self.document(); payload = self.import_payload(document); before = self.count()
        url = f"{self.base}/documents/{document['id']}/import"
        original = json.dumps(payload)
        for mutate, status in [(lambda p: p['questions'][0].update(answers=[]), 422), (lambda p: p['questions'][0].update(id=str(uuid4())), 422), (lambda p: p['questions'][0].update(content=' html   0 '), 409), (lambda p: p['questions'][1].update(content=p['questions'][0]['content'].upper()), 409), (lambda p: p['questions'][0].update(default_points='1.234'), 422)]:
            candidate = json.loads(original); mutate(candidate)
            response = self.client.post(url, json=candidate, headers=self.headers())
            self.assertEqual(response.status_code, status, response.text); self.assertEqual(self.count(), before)
        with patch.object(self.db, 'commit', side_effect=SQLAlchemyError('synthetic failure')):
            response = self.client.post(url, json=payload, headers=self.headers())
            self.assertEqual(response.json()['error']['code'], 'IMPORT_FAILED')
        self.assertEqual(self.count(), before)
        self.assertEqual(self.client.post(url, json=payload, headers=self.headers()).status_code, 200)

    def test_missing_provider_is_explicit_no_fake_ai(self):
        with patch('app.api.v1.question_documents.generation_available', return_value=False), patch('app.api.v1.question_documents.provider_status', return_value={'configured': False, 'error': {'code': 'AI_NOT_CONFIGURED', 'message': 'AI chưa được cấu hình'}}):
            self.assertFalse(self.client.get(f'{self.base}/document-capabilities', headers=self.headers()).json()['data']['generation_available'])
            document = self.document()
            result = self.prepare(document['id'], 'generate', count=6)
            self.assertEqual(result.status_code, 503); self.assertEqual(result.json()['error']['code'], 'AI_NOT_CONFIGURED')
            self.assertEqual(self.prepare(document['id']).status_code, 200)

    def test_retry_after_commit_but_failed_private_receipt_does_not_duplicate(self):
        document = self.document(); payload = self.import_payload(document); before = self.count()
        url = f"{self.base}/documents/{document['id']}/import"
        with patch.object(storage, 'save_session', side_effect=OSError('synthetic receipt failure')):
            response = self.client.post(url, json=payload, headers=self.headers())
            self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(self.count(), before + 2)
        response = self.client.post(url, json=payload, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data']['imported_count'], 2)
        self.assertEqual(self.count(), before + 2)

    def test_provider_failures_keep_exact_code_and_do_not_import_questions(self):
        from app.services.ai_provider import AI_MESSAGES
        document = self.document(); before = self.count()
        with patch('app.api.v1.question_documents.generation_available', return_value=True), patch('app.api.v1.question_documents.get_question_generation_provider') as factory:
            self.assertEqual(self.prepare(document['id'], 'generate', count=1).status_code, 200)
            for code, status in [('AI_RATE_LIMITED', 429), ('AI_AUTH_FAILED', 502), ('AI_INVALID_RESPONSE', 502), ('AI_MODEL_UNSUPPORTED', 502)]:
                factory.return_value.generate.side_effect = DocumentError(code, AI_MESSAGES[code])
                response = self.client.post(f"{self.base}/documents/{document['id']}/batches/0", headers=self.headers())
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()['error']['code'], code)
                self.assertEqual(response.json()['error']['message'], AI_MESSAGES[code])
                self.assertEqual(self.count(), before)

    def test_batched_generation_retry_resumes_and_regenerate_preserves_other_drafts(self):
        document = self.document(); before = self.count(); serial = [0]
        def generate(*, sources, requirements, config, excluded):
            serial[0] += 1
            output = []
            for source in sources:
                for index in range(requirements[source['id']]):
                    output.append({'content': f'Test generation {serial[0]} / {index} / {source["id"]}', 'options': ['Structure', 'Styling'], 'answers': ['Structure'], 'explanation': 'Review required', 'source_chunk_id': source['id'], 'source_excerpt': source['text'][:60]})
            return validate_generated(GeneratedBatch.model_validate({'questions': output}), sources=sources, requirements=requirements, config=config, excluded=excluded)
        provider = SimpleNamespace(generate=generate)
        with patch('app.api.v1.question_documents.generation_available', return_value=True), patch('app.api.v1.question_documents.get_question_generation_provider', return_value=provider):
            planned = self.prepare(document['id'], 'generate', count=7).json()['data']
            self.assertEqual([batch['count'] for batch in planned['batches']], [5, 2])
            base = f"{self.base}/documents/{document['id']}"
            first = self.client.post(base + '/batches/0', headers=self.headers()); self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(len(first.json()['data']['questions']), 5)
            invalid = json.loads(json.dumps(first.json()['data']['questions']))
            invalid[0]['answers'] = []
            self.assertEqual(self.client.post(base + '/import', json={'questions': invalid}, headers=self.headers()).status_code, 422)
            self.assertEqual(self.count(), before)
            self.assertEqual(self.client.post(base + '/batches/0', headers=self.headers()).json(), first.json()); self.assertEqual(serial[0], 1)
            with patch.object(provider, 'generate', side_effect=DocumentError('GENERATION_TIMEOUT', 'Timeout')):
                self.assertEqual(self.client.post(base + '/batches/1', headers=self.headers()).status_code, 504)
            saved = self.client.get(base, headers=self.headers()).json()['data']; self.assertEqual(len(saved['questions']), 5); self.assertFalse(saved['batches'][1]['complete'])
            with patch.object(storage, 'save_session', side_effect=OSError('private storage path')):
                failed_save = self.client.post(base + '/batches/1', headers=self.headers())
                self.assertEqual(failed_save.status_code, 503)
                self.assertEqual(failed_save.json()['error']['code'], 'DOCUMENT_STORAGE_ERROR')
                self.assertNotIn('private storage path', failed_save.text)
            saved = self.client.get(base, headers=self.headers()).json()['data']
            self.assertEqual(len(saved['questions']), 5); self.assertFalse(saved['batches'][1]['complete'])
            last = self.client.post(base + '/batches/1', headers=self.headers()).json()['data']; self.assertEqual(len(last['questions']), 7)
            self.assertEqual(self.count(), before)
            old = last['questions'][0]
            with patch.object(provider, 'generate', return_value=[]):
                insufficient = self.client.post(base + f'/drafts/{old["id"]}/regenerate', headers=self.headers())
                self.assertEqual(insufficient.status_code, 422)
                unchanged = self.client.get(base, headers=self.headers()).json()['data']
                self.assertEqual(unchanged['questions'], last['questions'])
            new = self.client.post(base + f'/drafts/{old["id"]}/regenerate', headers=self.headers()).json()['data']
            self.assertEqual(new['id'], old['id']); self.assertNotEqual(new['content'], old['content'])
            final = self.client.get(base, headers=self.headers()).json()['data']; self.assertEqual(final['questions'][1:], last['questions'][1:])
            self.assertEqual(self.count(), before)

    def test_partial_import_validates_selected_drafts_and_closes_session_without_feedback(self):
        document = self.document(); before = self.count()
        payload = self.import_payload(document)
        # The selected drafts already exist; an independent generation batch
        # failed. No teacher feedback is required by the import contract.
        with storage.document_session(document['id'], self.bank.id, self.teacher.id) as session:
            session['config']['mode'] = 'generate'
            session['batches'] = [{'index': 0, 'count': 2, 'complete': True},
                                  {'index': 1, 'count': 5, 'complete': False,
                                   'error': {'code': 'UNGROUNDED_GENERATION', 'message': 'Source mismatch'}}]
            storage.save_session(session)
        url = f"{self.base}/documents/{document['id']}"
        invalid = json.loads(json.dumps(payload)); invalid['questions'][0]['answers'] = []
        self.assertEqual(self.client.post(url + '/import', json=invalid, headers=self.headers()).status_code, 422)
        self.assertEqual(self.count(), before)
        foreign = json.loads(json.dumps(payload)); foreign['questions'][0]['id'] = str(uuid4())
        self.assertEqual(self.client.post(url + '/import', json=foreign, headers=self.headers()).status_code, 422)
        self.assertEqual(self.count(), before)
        response = self.client.post(url + '/import', json=payload, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data']['imported_count'], 2)
        self.assertEqual(self.count(), before + 2)
        self.assertEqual(self.client.post(url + '/import', json=payload, headers=self.headers()).json(), response.json())
        saved = self.client.get(url, headers=self.headers()).json()['data']
        self.assertEqual(saved['questions'], []); self.assertEqual(saved['batches'], [])
        self.assertEqual(saved['imported_count'], 2)
        self.assertEqual(self.client.post(url + '/batches/1', headers=self.headers()).status_code, 409)

    def test_insufficient_source_can_finish_with_zero_drafts(self):
        document = self.document()
        with patch('app.api.v1.question_documents.generation_available', return_value=True), patch('app.api.v1.question_documents.get_question_generation_provider') as factory:
            factory.return_value.generate.return_value = []
            self.assertEqual(self.prepare(document['id'], 'generate', count=3).status_code, 200)
            url = f"{self.base}/documents/{document['id']}"
            response = self.client.post(url + '/batches/0', headers=self.headers())
            self.assertEqual(response.status_code, 200)
            data = response.json()['data']
            self.assertEqual(data['questions'], [])
            self.assertTrue(data['batches'][0]['complete'])
            self.assertEqual(data['batches'][0]['generated_count'], 0)
            self.assertTrue(data['warnings'])


class DocumentContractTests(TestCase):
    def test_expiration_removes_interrupted_atomic_source_writes(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            stale = root / f'{uuid4()}.{uuid4().hex}.tmp'
            fresh = root / f'{uuid4()}.{uuid4().hex}.tmp'
            stale.write_text('private source', encoding='utf-8'); fresh.write_text('in-progress source', encoding='utf-8')
            old = (datetime.now(timezone.utc) - timedelta(hours=3)).timestamp()
            os.utime(stale, (old, old))
            storage.cleanup_expired(root)
            self.assertFalse(stale.exists()); self.assertTrue(fresh.exists())

    def test_word_headings_stay_with_their_text_and_tiny_source_is_not_generated(self):
        sections = [{'text': 'HTML', 'page': None, 'label': 'Phần 1'}, {'text': 'HTML describes the structure of a webpage.', 'page': None, 'label': 'Phần 2'}]
        chunks = chunk_sections(sections)
        self.assertEqual(len(chunks), 1); self.assertEqual(chunks[0]['label'], 'Phần 1 – Phần 2')
        self.assertIn('HTML\nHTML describes', chunks[0]['text']); self.assertIsNone(chunks[0]['page'])
        with self.assertRaises(DocumentError):
            storage.generation_plan(chunk_sections(sections[:1]), 1)

    def test_full_answer_text_does_not_guess_letters_from_prose(self):
        drafts = storage.parse_existing_questions([{'text': 'Câu 1: HTML là gì?\nA. Styling\nB. Cấu trúc trang web\nC. Network\nĐáp án: Cấu trúc trang web\nCâu 2: Thiếu đáp án xác định\nA. Styling\nB. Layout\nC. Network\nĐáp án: Cần xác nhận lại', 'page': None, 'label': 'Phần 1'}])
        self.assertEqual(drafts[0]['answers'], ['Cấu trúc trang web'])
        self.assertEqual(drafts[1]['answers'], [])

    def test_parser_retains_missing_answers_empty_content_and_multi_answers_for_review(self):
        drafts = storage.parse_existing_questions([{'text': 'Câu 1: \nA. One\nB. Two\nĐáp án: A, B\nCâu 2: Chưa có đáp án\nA. A\nB. B', 'page': 3, 'label': 'Trang 3'}])
        self.assertEqual(drafts[0]['type'], 'mcq_multi'); self.assertEqual(drafts[0]['answers'], ['One', 'Two'])
        self.assertEqual(drafts[0]['content'], ''); self.assertTrue(drafts[0]['warnings'])
        self.assertEqual(drafts[1]['answers'], []); self.assertTrue(drafts[1]['warnings'])
        with self.assertRaises(ValueError):
            ImportDrafts.model_validate({'questions': drafts})

    def test_long_document_chunks_bounded_plan_spans_first_to_last_exact_count(self):
        sections = [{'text': ('Long source section with grounded facts. ' * 120), 'page': page, 'label': f'Page {page}'} for page in range(1, 101)]
        chunks = chunk_sections(sections)
        self.assertTrue(all(len(chunk['text']) <= 2400 for chunk in chunks))
        plan = storage.generation_plan(chunks, 20)
        self.assertEqual(sum(batch['count'] for batch in plan), 20)
        used = [source for batch in plan for source in batch['sources']]
        self.assertEqual(used[0]['page'], 1); self.assertEqual(used[-1]['page'], 100)
        self.assertTrue(all(batch['count'] <= 5 and len(batch['sources']) <= 5 for batch in plan))

    def test_structured_adapter_server_key_validation_and_safe_errors(self):
        source = {'id': 'chunk-1', 'text': 'HTML describes the structure of a webpage.', 'page': 2, 'label': 'Trang 2'}
        config = {'question_type': 'mcq_single', 'difficulty': 'medium', 'topic': 'Web'}
        question = {'content': 'What does HTML describe?', 'options': ['Structure', 'Styling'], 'answers': ['Structure'], 'explanation': 'The document describes structure.', 'source_chunk_id': 'chunk-1', 'source_excerpt': source['text']}
        settings = SimpleNamespace(QUESTION_GENERATION_BASE_URL='https://provider.example/v1', QUESTION_GENERATION_MODEL='configured-model', QUESTION_GENERATION_API_KEY='server-test-secret', QUESTION_GENERATION_TIMEOUT=30)
        provider = OpenAICompatibleQuestionProvider(settings)
        def invoke(body, finish='stop', refusal=None):
            def handler(request):
                self.assertEqual(request.headers['authorization'], 'Bearer server-test-secret')
                payload = json.loads(request.content); self.assertEqual(payload['response_format']['type'], 'json_schema')
                self.assertTrue(payload['response_format']['json_schema']['strict']); self.assertNotIn('tools', payload)
                self.assertNotIn('server-test-secret', json.dumps(payload))
                return httpx.Response(200, json={'choices': [{'finish_reason': finish, 'message': {'content': json.dumps(body), 'refusal': refusal}}]})
            client = httpx.Client(transport=httpx.MockTransport(handler))
            with patch('app.services.question_generation.httpx.Client', return_value=client):
                return provider.generate(sources=[source], requirements={'chunk-1': 1}, config=config, excluded=[])
        result = invoke({'questions': [question]})
        self.assertEqual(result[0]['source_page'], 2); self.assertEqual(result[0]['answers'], ['Structure'])
        for changed, code in [({**question, 'source_excerpt': 'Invented fact outside source'}, 'UNGROUNDED_GENERATION'), ({**question, 'answers': ['Invalid']}, 'INVALID_GENERATION'), ({**question, 'source_chunk_id': 'unknown'}, 'INVALID_GENERATION')]:
            with self.assertRaises(DocumentError) as error:
                invoke({'questions': [changed]})
            self.assertEqual(error.exception.code, code); self.assertNotIn('server-test-secret', error.exception.message)
        self.assertEqual(invoke({'questions': []}), [])  # Insufficient source is allowed; never invent to fill the count.
        for body, finish, refusal in [({'questions': [question]}, 'length', None), ({'questions': [question]}, 'stop', 'refusal')]:
            with self.assertRaises(DocumentError):
                invoke(body, finish, refusal)
