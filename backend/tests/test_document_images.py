"""Real embedded media extraction, ownership, lifetime and multimodal contracts."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from docx import Document
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject, DecodedStreamObject, DictionaryObject, ArrayObject
import httpx
from sqlalchemy.exc import SQLAlchemyError

from app.models.entities import ExamAttempt, ExamQuestion, AttemptStatus
from app.schemas.content import QuestionForStudent
from app.services import question_document_drafts as storage, question_images as attachments
from app.services.question_document_extract import extract_document, DocumentError
from app.services.question_document_extract import chunk_sections
from app.services.question_generation import OpenAICompatibleQuestionProvider
from tests import test_question_documents as documents


def png_bytes():
    output = BytesIO(); Image.new('RGB', (32, 24), 'navy').save(output, 'PNG')
    return output.getvalue()


def image_docx():
    doc = Document()
    doc.add_paragraph('Tài liệu ôn tập mạng')
    paragraph = doc.add_paragraph('Câu 8: Quan sát sơ đồ mạng trong hình. ' + 'Mô tả kết nối của các thiết bị. ' * 22)
    paragraph.add_run().add_picture(BytesIO(png_bytes()))
    paragraph.add_run('\nA. Hai mạng\nB. Một mạng\nĐáp án: A')
    doc.add_paragraph('Câu 9: IPv4 có bao nhiêu bit?\nA. 32\nB. 64\nĐáp án: A')
    # Table images must follow their containing question, including nested cells.
    table = doc.add_table(rows=1, cols=1)
    table.cell(0, 0).paragraphs[0].add_run().add_picture(BytesIO(png_bytes()))
    output = BytesIO(); doc.save(output)
    return output.getvalue()


def image_pdf():
    writer = PdfWriter(); page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    picture = DecodedStreamObject(); picture.set_data(Image.new('RGB', (32, 24), 'navy').tobytes())
    picture.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Image'),
                    NameObject('/Width'): NumberObject(32), NameObject('/Height'): NumberObject(24),
                    NameObject('/ColorSpace'): NameObject('/DeviceRGB'), NameObject('/BitsPerComponent'): NumberObject(8)})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)}),
        NameObject('/XObject'): DictionaryObject({NameObject('/Im0'): writer._add_object(picture)})})
    commands = ['BT /F1 12 Tf 40 740 Td (Question 1: Which network is shown?) Tj ET',
                'BT /F1 12 Tf 40 540 Td (A. One network) Tj 0 -16 Td (B. Two networks) Tj 0 -16 Td (Answer: B) Tj ET',
                'BT /F1 12 Tf 40 450 Td (Question 2: How many IPv4 bits?) Tj 0 -16 Td (A. 32) Tj 0 -16 Td (B. 64) Tj 0 -16 Td (Answer: A) Tj ET',
                # Deliberately paint the image AFTER text in the stream, but
                # spatially between question 1 and its options.
                'q 100 0 0 60 40 600 cm /Im0 Do Q']
    stream = DecodedStreamObject(); stream.set_data('\n'.join(commands).encode('ascii'))
    page[NameObject('/Contents')] = writer._add_object(stream)
    writer.add_blank_page(width=612, height=792)
    output = BytesIO(); writer.write(output); return output.getvalue()


class DocumentImageApiTests(TestCase):
    headers = documents.DocumentApiTests.headers
    upload = documents.DocumentApiTests.upload
    prepare = documents.DocumentApiTests.prepare
    count = documents.DocumentApiTests.count
    import_payload = documents.DocumentApiTests.import_payload

    def setUp(self):
        documents.DocumentApiTests.setUp(self)
        root = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.object(attachments, 'QUESTION_IMAGE_ROOT', Path(root)))

    def image_session(self):
        response = self.upload(image_docx())
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def test_metadata_coherent_preview_real_count_and_docx_ordered_association(self):
        session = self.image_session()
        self.assertEqual(session['image_count'], 2)
        self.assertEqual(session['file_type'], 'docx')
        self.assertEqual(session['structured_question_count'], 2)
        self.assertIsNone(session['page_count'])
        self.assertGreaterEqual(len(session['preview_text']), 500)
        self.assertLessEqual(len(session['preview_text']), 1000)
        self.assertTrue(session['preview_text'].startswith('Câu 8:'))
        self.assertNotIn('data_base64', json.dumps(session))
        self.assertNotIn(str(storage.DOCUMENT_ROOT), json.dumps(session))
        with patch('app.api.v1.question_documents.get_question_generation_provider', return_value=SimpleNamespace(supports_vision=False)):
            questions = self.import_payload(session)['questions']
        self.assertEqual([q['images'][0]['question_number'] for q in questions], [8, 9])
        self.assertEqual(questions[0]['answers'], ['Hai mạng'])
        self.assertEqual(questions[1]['answers'], ['32'])
        self.assertTrue(questions[0]['images'][0]['position']['paragraph'])
        self.assertEqual(questions[0]['warning_codes'], ['IMAGE_REQUIRES_VISION'])

    def test_87_is_actual_count_and_unstructured_document_has_no_question_count(self):
        text = '\n'.join(f'Question {index}: Sample question?\nA. Yes\nB. No\nAnswer: A' for index in range(1, 88))
        session = self.upload(documents.docx_bytes(text)).json()['data']
        self.assertEqual(session['structured_question_count'], 87)
        plain = self.upload(documents.docx_bytes('A long paragraph about routing. ' * 30)).json()['data']
        self.assertIsNone(plain['structured_question_count'])

    def test_pdf_text_layer_page_bbox_and_question_association(self):
        response = self.upload(image_pdf(), 'pdf')
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()['data']
        self.assertEqual(session['page_count'], 2)
        self.assertEqual(session['image_count'], 1)
        self.assertEqual(session['images'][0]['page'], 1)
        self.assertEqual(session['images'][0]['position']['bbox'], [40, 600, 140, 660])
        questions = self.import_payload(session)['questions']
        self.assertEqual(len(questions[0]['images']), 1)
        self.assertEqual(questions[1]['images'], [])
        self.assertEqual(questions[0]['answers'], ['Two networks'])

    def test_private_preview_cancel_and_ttl_remove_temporary_images(self):
        for expire in (False, True):
            session = self.image_session(); image = session['images'][0]
            url = '/api/v1' + image['temp_url']
            response = self.client.get(url, headers=self.headers())
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(response.content, png_bytes())
            self.assertEqual(self.client.get(url, headers=self.headers(self.other)).status_code, 404)
            self.assertEqual(self.client.get(url, headers=self.headers(self.admin)).status_code, 404)
            self.assertEqual(self.client.get(url, headers=self.headers(self.student)).status_code, 403)
            folder = storage.DOCUMENT_ROOT / session['id']
            if expire:
                path = storage.DOCUMENT_ROOT / (session['id'] + '.json')
                data = json.loads(path.read_text(encoding='utf-8'))
                data['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
                storage.save_session(data); storage.cleanup_expired()
            else:
                self.client.delete(f"{self.base}/documents/{session['id']}", headers=self.headers())
            self.assertFalse(folder.exists())
            self.assertIn(self.client.get(url, headers=self.headers()).status_code, (404, 410))

    def test_import_keeps_private_images_for_students_actual_attempt_only(self):
        session = self.image_session(); payload = self.import_payload(session)
        response = self.client.post(f"{self.base}/documents/{session['id']}/import", json=payload, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse((storage.DOCUMENT_ROOT / session['id']).exists())
        question_id = payload['questions'][0]['id']; image_id = payload['questions'][0]['images'][0]['id']
        from uuid import UUID
        question = self.db.get(documents.Question, UUID(question_id))
        serialized = QuestionForStudent.model_validate(question).model_dump(mode='json')
        self.assertNotIn('nearby_paragraph', json.dumps(serialized))
        self.assertNotIn('correct_answer', json.dumps(serialized))
        url = '/api/v1' + serialized['images'][0]['preview_url']
        self.assertEqual(self.client.get(url, headers=self.headers()).status_code, 200)
        self.assertEqual(self.client.get(url, headers=self.headers(self.other)).status_code, 404)
        self.assertEqual(self.client.get(url, headers=self.headers(self.student)).status_code, 404)
        ExamAttempt.__table__.create(self.engine, checkfirst=True)
        attempt = ExamAttempt(id=uuid4(), exam_id=self.exam.id, student_id=self.student.id,
                              status=AttemptStatus.in_progress, attempt_number=1)
        self.db.add(attempt); self.db.add(ExamQuestion(id=uuid4(), exam_id=self.exam.id, question_id=question.id, order_index=0, points=1)); self.db.commit()
        image_url = url + f'?attempt_id={attempt.id}'
        self.assertEqual(self.client.get(image_url, headers=self.headers(self.student)).status_code, 200)
        attempt.status = AttemptStatus.not_started; self.db.commit()
        self.assertEqual(self.client.get(image_url, headers=self.headers(self.student)).status_code, 404)
        self.assertEqual(self.client.get(url + f'?attempt_id={uuid4()}', headers=self.headers(self.student)).status_code, 404)
        state = json.loads((storage.DOCUMENT_ROOT / (session['id'] + '.json')).read_text(encoding='utf-8'))
        state['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(); storage.save_session(state); storage.cleanup_expired()
        self.assertTrue(attachments.attachment_path(question_id, image_id).exists())

    def test_failed_atomic_import_cleans_copies_and_retry_keeps_attachments(self):
        session = self.image_session(); payload = self.import_payload(session); before = self.count()
        url = f"{self.base}/documents/{session['id']}/import"
        with patch.object(self.db, 'commit', side_effect=SQLAlchemyError('test failure')):
            response = self.client.post(url, json=payload, headers=self.headers())
            self.assertEqual(response.json()['error']['code'], 'IMPORT_FAILED')
        self.assertEqual(self.count(), before)
        self.assertEqual(list(attachments.QUESTION_IMAGE_ROOT.glob('*/*.png')), [])
        self.assertTrue((storage.DOCUMENT_ROOT / session['id']).exists())
        with patch.object(storage, 'save_session', side_effect=OSError('receipt failure')):
            response = self.client.post(url, json=payload, headers=self.headers())
            self.assertEqual(response.status_code, 503)
        self.assertEqual(self.count(), before + 2)
        response = self.client.post(url, json=payload, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.count(), before + 2)
        self.assertEqual(len(list(attachments.QUESTION_IMAGE_ROOT.glob('*/*.png'))), 2)
        self.assertFalse((storage.DOCUMENT_ROOT / session['id']).exists())

    def test_foreign_or_removed_image_cannot_be_imported(self):
        session = self.image_session(); payload = self.import_payload(session)
        url = f"{self.base}/documents/{session['id']}/import"
        for images in ([], [{**payload['questions'][0]['images'][0], 'id': str(uuid4())}]):
            modified = json.loads(json.dumps(payload)); modified['questions'][0]['images'] = images
            self.assertEqual(self.client.post(url, json=modified, headers=self.headers()).status_code, 422)

    def test_crash_copy_cleanup_preserves_images_of_saved_questions(self):
        session = self.image_session(); payload = self.import_payload(session)
        self.assertEqual(self.client.post(f"{self.base}/documents/{session['id']}/import", json=payload, headers=self.headers()).status_code, 200)
        saved_folder = attachments.QUESTION_IMAGE_ROOT / payload['questions'][0]['id']
        orphan = attachments.QUESTION_IMAGE_ROOT / str(uuid4()); orphan.mkdir(); (orphan / 'unused.png').write_bytes(png_bytes())
        old = time.time() - 7201
        os.utime(saved_folder, (old, old)); os.utime(orphan, (old, old))
        attachments.cleanup_orphan_images(self.db)
        self.assertFalse(orphan.exists()); self.assertTrue(saved_folder.exists())

    def test_teacher_can_associate_unmapped_picture_from_same_document(self):
        doc = Document(); doc.add_picture(BytesIO(png_bytes()))
        doc.add_paragraph(documents.TEXT)
        output = BytesIO(); doc.save(output)
        response = self.upload(output.getvalue()); self.assertEqual(response.status_code, 200, response.text)
        session = response.json()['data']; self.assertIsNone(session['images'][0]['question_number'])
        payload = self.import_payload(session); self.assertEqual(payload['questions'][0]['images'], [])
        # Client metadata is never trusted; only the selected source ID is used.
        payload['questions'][0]['images'] = [{**session['images'][0], 'page': 999, 'temp_url': 'https://ignored.example/image'}]
        result = self.client.post(f"{self.base}/documents/{session['id']}/import", json=payload, headers=self.headers())
        self.assertEqual(result.status_code, 200, result.text)
        from uuid import UUID
        row = self.db.get(documents.Question, UUID(payload['questions'][0]['id']))
        self.assertIsNone(row.images_json[0]['page'])
        self.assertNotIn('ignored.example', json.dumps(row.images_json))


class MultimodalGenerationTests(TestCase):
    def test_explicit_heading_without_colon_preserves_picture_and_ip_is_not_a_question(self):
        doc = Document(); doc.add_paragraph('Question 8')
        doc.add_paragraph('How is the topology connected?\n192.168.0.1')
        doc.add_picture(BytesIO(png_bytes()))
        doc.add_paragraph('A. Two networks\nB. One network\nAnswer: A')
        output = BytesIO(); doc.save(output)
        with TemporaryDirectory() as root, patch.object(storage, 'DOCUMENT_ROOT', Path(root)):
            session = storage.new_session(uuid4(), uuid4(), 'heading.docx', extract_document(output.getvalue(), 'docx'))
            drafts = storage.parse_existing_questions(session['sections'], images=session['images'])
            self.assertEqual(session['structured_question_count'], 1)
            self.assertTrue(session['preview_text'].startswith('Question 8'))
            self.assertEqual(drafts[0]['images'][0]['question_number'], 8)
            self.assertIn('192.168.0.1', drafts[0]['content'])

    def test_header_media_is_extracted_without_inventing_question_or_paragraph(self):
        doc = Document(); doc.add_paragraph(documents.TEXT)
        doc.sections[0].header.paragraphs[0].add_run().add_picture(BytesIO(png_bytes()))
        output = BytesIO(); doc.save(output)
        extracted = extract_document(output.getvalue(), 'docx')
        self.assertEqual(extracted['image_count'], 1)
        self.assertIsNone(extracted['images'][0]['question_number'])
        self.assertEqual(extracted['images'][0]['nearby_paragraph'], '')
        self.assertEqual(extracted['images'][0]['position']['location'], 'document_media')

    def test_long_visual_question_keeps_options_and_image_context_in_every_chunk(self):
        doc = Document(); doc.add_paragraph('Question 1: ' + 'A fact about the network topology. ' * 130)
        doc.add_picture(BytesIO(png_bytes())); doc.add_paragraph('A. Two networks\nB. One network\nAnswer: A')
        output = BytesIO(); doc.save(output)
        with TemporaryDirectory() as root, patch.object(storage, 'DOCUMENT_ROOT', Path(root)):
            session = storage.new_session(uuid4(), uuid4(), 'long.docx', extract_document(output.getvalue(), 'docx'))
            sources = storage.generation_sources(session, session['chunks'])
            self.assertGreater(len(sources), 1)
            self.assertTrue(all(source['images'] for source in sources))
            self.assertTrue(all('A. Two networks' in source['question_context'] for source in sources))
            self.assertTrue(all(len(source['text']) <= 2400 for source in sources))

    def test_nonvision_generates_from_text_omits_image_bytes_and_flags_retained_pictures(self):
        settings = SimpleNamespace(QUESTION_GENERATION_BASE_URL='https://provider.example/v1', QUESTION_GENERATION_MODEL='configured-model', QUESTION_GENERATION_API_KEY='server-only', QUESTION_GENERATION_TIMEOUT=30)
        with TemporaryDirectory() as root, patch.object(storage, 'DOCUMENT_ROOT', Path(root)):
            session = storage.new_session(uuid4(), uuid4(), 'network.docx', extract_document(image_docx(), 'docx'))
            source = next(source for source in storage.generation_sources(session, session['chunks']) if source['images'])
            output = {'content': 'Nội dung văn bản đề cập đến điều gì?', 'options': ['Mạng máy tính', 'Văn học'], 'answers': ['Mạng máy tính'],
                      'explanation': 'Theo văn bản, hình chưa được phân tích.', 'source_chunk_id': source['id'], 'source_excerpt': source['text'][:100], 'image_ids': []}
            def handle(request):
                payload = json.loads(request.content)
                self.assertIsInstance(payload['messages'][1]['content'], str)
                self.assertNotIn('data:image', json.dumps(payload))
                self.assertNotIn('required_image_ids', payload['messages'][1]['content'])
                return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'questions': [output]})}}]})
            with patch('app.services.question_generation.httpx.Client', return_value=httpx.Client(transport=httpx.MockTransport(handle))), patch('app.services.question_generation.review_drafts', side_effect=lambda drafts, **kwargs: drafts):
                drafts = OpenAICompatibleQuestionProvider(settings).generate(sources=[source], requirements={source['id']: 1}, config={'question_type': 'mcq_single', 'difficulty': 'medium'}, excluded=[])
            self.assertEqual(drafts[0]['warning_codes'], ['IMAGE_REQUIRES_VISION'])
            self.assertTrue(drafts[0]['images'])
            self.assertNotIn('data_base64', json.dumps(drafts))

    def test_vision_sends_text_options_and_actual_image_together_and_preserves_mapping(self):
        with TemporaryDirectory() as root, patch.object(storage, 'DOCUMENT_ROOT', Path(root)):
            session = storage.new_session(uuid4(), uuid4(), 'network.docx', extract_document(image_docx(), 'docx'))
            source = next(source for source in storage.generation_sources(session, session['chunks']) if source['images'])
            config = {'question_type': 'mcq_single', 'difficulty': 'medium', 'topic': None}
            output = {'content': 'Sơ đồ có bao nhiêu mạng?', 'options': ['Hai mạng', 'Một mạng'], 'answers': ['Hai mạng'],
                      'explanation': 'Quan sát sơ đồ.', 'source_chunk_id': source['id'], 'source_excerpt': source['text'][:100],
                      'image_ids': source['image_ids']}
            def handle(request):
                payload = json.loads(request.content)
                content = payload['messages'][1]['content']
                self.assertEqual(content[0]['type'], 'text')
                self.assertIn('Hai mạng', content[0]['text'])
                image = next(item for item in content if item['type'] == 'image_url')
                self.assertTrue(image['image_url']['url'].startswith('data:image/png;base64,'))
                self.assertNotIn('server-only', json.dumps(payload))
                return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'questions': [output]})}}]})
            settings = SimpleNamespace(QUESTION_GENERATION_BASE_URL='https://provider.example/v1', QUESTION_GENERATION_MODEL='vision-model', QUESTION_GENERATION_API_KEY='server-only', QUESTION_GENERATION_TIMEOUT=30, QUESTION_GENERATION_SUPPORTS_VISION=True)
            with patch('app.services.question_generation.httpx.Client', return_value=httpx.Client(transport=httpx.MockTransport(handle))), patch('app.services.question_generation.review_drafts', side_effect=lambda drafts, **kwargs: drafts):
                drafts = OpenAICompatibleQuestionProvider(settings).generate(sources=[source], requirements={source['id']: 1}, config=config, excluded=[])
            self.assertEqual(drafts[0]['images'][0]['id'], source['image_ids'][0])
            self.assertNotIn('data_base64', json.dumps(drafts))
