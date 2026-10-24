"""Release acceptance with the real PostgreSQL API, never the application DB.

Run through scripts/release_qa_runtime.py with RUN_RELEASE_POSTGRES=1.
All persisted accounts/data are explicitly labelled QA. No provider is mocked.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
from pathlib import Path
import re
import secrets
from tempfile import TemporaryDirectory
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.entities import Answer, DetectionEvent, ExamAttempt, Notification, ProctoringSession, User, UserRole


@skipUnless(os.environ.get('RUN_RELEASE_POSTGRES') == '1', 'Explicit disposable release PostgreSQL acceptance')
class ReleasePostgresTests(TestCase):
    @classmethod
    def setUpClass(cls):
        if not re.fullmatch(r'ai_procto_release_qa_[0-9a-f]{16}', make_url(settings.DATABASE_URL).database or ''):
            raise RuntimeError('Refusing release checks outside the isolated QA database')
        cls.password = secrets.token_urlsafe(20)
        cls.actors = {}
        with SessionLocal() as db:
            for key, role in [('admin', 'admin'), ('teacher', 'teacher'), ('other_teacher', 'teacher'), ('student', 'student'), ('other_student', 'student')]:
                row = User(id=uuid4(), full_name='QA ' + key.replace('_', ' ').title(), email=f'qa-{uuid4().hex}@example.com',
                           role=UserRole(role), password_hash=hash_password(cls.password), is_active=True)
                db.add(row); db.flush()
                cls.actors[key] = {'id': str(row.id), 'email': row.email, 'role': role}
            db.commit()
        cls.client = cls.enterClassContext(TestClient(app))

    def headers(self, actor='teacher'):
        row = self.actors[actor]
        return {'Authorization': 'Bearer ' + create_access_token(row['id'], row['role'])}

    def api(self, method, path, actor='teacher', expected=200, **kwargs):
        response = self.client.request(method, '/api/v1' + path, headers=self.headers(actor), **kwargs)
        self.assertEqual(response.status_code, expected, response.text if response.status_code != expected else '')
        return response.json().get('data')

    def scenario(self):
        cls = self.api('POST', '/classes', json={'name': 'QA: Release class ' + uuid4().hex[:8]})
        self.api('POST', f'/classes/{cls["id"]}/enrollments', json={'student_id': self.actors['student']['id']})
        bank = self.api('POST', '/question-banks', json={'name': 'QA: Release bank ' + uuid4().hex[:8], 'subject': 'Software testing'})
        questions = []
        for kind in ['mcq_single', 'essay']:
            payload = {'question_bank_id': bank['id'], 'type': kind, 'content': 'QA: Explain the purpose of HTTP.', 'default_points': 2}
            if kind == 'mcq_single':
                payload.update(options_json={'options': [{'id': 'a', 'text': 'Transfer web resources'}, {'id': 'b', 'text': 'Store database rows'}]},
                               correct_answer_json={'correct_option_id': 'a'})
            questions.append(self.api('POST', f'/question-banks/{bank["id"]}/questions', json=payload))
        now = datetime.now(timezone.utc)
        exam = self.api('POST', '/exams', json={'title': 'QA: Release exam ' + uuid4().hex[:8], 'start_time': (now - timedelta(minutes=5)).isoformat(),
            'end_time': (now + timedelta(hours=1)).isoformat(), 'duration_minutes': 30, 'require_camera': False,
            'require_mic': False, 'require_fullscreen': False, 'allow_review': True})
        for index, question in enumerate(questions):
            self.api('POST', f'/exams/{exam["id"]}/questions', json={'question_id': question['id'], 'order_index': index, 'points': 2})
        self.api('POST', f'/exam-assignments?exam_id={exam["id"]}', json={'class_id': cls['id']})
        self.api('PATCH', f'/exams/{exam["id"]}', json={'status': 'published'})
        attempt = self.api('POST', '/attempts', 'student', json={'exam_id': exam['id']})
        return cls, bank, questions, exam, attempt

    def test_auth_case_insensitive_refresh_disabled_account_and_logout_cookies(self):
        email = f'qa-register-{uuid4().hex}@example.com'
        response = self.client.post('/api/v1/auth/register', json={'full_name': 'QA Registered Student', 'email': email.upper(), 'password': self.password})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['role'], 'student')
        self.assertEqual(response.json()['user']['email'], email)
        response = self.client.post('/api/v1/auth/login', json={'email': email.upper(), 'password': self.password})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.post('/api/v1/auth/refresh').status_code, 200)
        self.assertEqual(self.client.post('/api/v1/auth/logout').status_code, 200)
        self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 401)
        self.assertEqual(self.client.post('/api/v1/auth/refresh').status_code, 401)
        student = self.actors['other_student']
        try:
            self.api('PATCH', '/users/' + student['id'], 'admin', json={'is_active': False})
            response = self.client.post('/api/v1/auth/login', json={'email': student['email'], 'password': self.password})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()['error']['code'], 'ACCOUNT_DISABLED')
            self.assertEqual(self.client.get('/api/v1/auth/me', headers=self.headers('other_student')).status_code, 401)
        finally:
            self.api('PATCH', '/users/' + student['id'], 'admin', json={'is_active': True})

    def test_role_and_random_uuid_boundaries_are_enforced_by_the_api(self):
        for method, path, data in [('GET', '/users', None), ('PATCH', '/users/' + self.actors['student']['id'], {'role': 'admin'}),
                                  ('GET', '/teacher/reports', None), ('GET', '/audit-logs', None),
                                  ('GET', '/admin/student-cards', None), ('GET', '/question-banks', None)]:
            self.api(method, path, 'student', expected=403, **({'json': data} if data else {}))
        self.api('PATCH', '/auth/me', 'student', expected=422, json={'role': 'admin'})
        forged_role = create_access_token(self.actors['student']['id'], 'admin')
        self.assertEqual(self.client.get('/api/v1/users', headers={'Authorization': 'Bearer ' + forged_role}).status_code, 403)
        for path in ['/users/' + str(uuid4()), '/attempts/' + str(uuid4()), '/classes/' + str(uuid4()), '/exams/' + str(uuid4()),
                     '/chat/conversations/' + str(uuid4()), '/identity/student-card/previews/' + str(uuid4()) + '/card']:
            response = self.client.get('/api/v1' + path, headers=self.headers('student'))
            self.assertIn(response.status_code, (403, 404), path)
        self.api('GET', '/users/not-a-uuid', 'admin', expected=422)

    def test_classes_candidates_duplicate_remove_and_question_crud(self):
        cls = self.api('POST', '/classes', json={'name': 'QA: Membership ' + uuid4().hex[:8]})
        student_id = self.actors['student']['id']
        path = f'/classes/{cls["id"]}/enrollments'
        self.api('POST', path, json={'student_id': student_id})
        candidates = self.api('GET', path + '/available?limit=100')
        self.assertNotIn(student_id, [row['id'] for row in candidates])
        self.api('POST', path, expected=409, json={'student_id': student_id})
        self.api('DELETE', path + '/' + student_id)
        candidates = self.api('GET', path + '/available?limit=100')
        self.assertIn(student_id, [row['id'] for row in candidates])
        bank = self.api('POST', '/question-banks', json={'name': 'QA: CRUD ' + uuid4().hex[:8]})
        question = self.api('POST', f'/question-banks/{bank["id"]}/questions', json={'question_bank_id': bank['id'], 'type': 'essay', 'content': 'QA searchable content'})
        self.api('PATCH', '/question-banks/questions/' + question['id'], json={'content': 'QA updated searchable content'})
        found = self.api('GET', f'/question-banks/{bank["id"]}/questions?q=updated&type=essay&limit=20')
        self.assertEqual([row['id'] for row in found], [question['id']])
        self.api('DELETE', '/question-banks/questions/' + question['id'])
        self.assertEqual(self.api('GET', f'/question-banks/{bank["id"]}/questions?is_active=true'), [])

    def test_submission_and_manual_grade_share_one_persisted_score(self):
        _, _, questions, exam, attempt = self.scenario()
        attempt_id = attempt['id']
        self.api('POST', f'/attempts/{attempt_id}/answers', 'student', json={'question_id': questions[0]['id'], 'answer_content': {'selected_option_id': 'a'}})
        self.api('POST', f'/attempts/{attempt_id}/answers', 'student', json={'question_id': questions[1]['id'], 'answer_content': {'text': 'HTTP transfers web resources between clients and servers.'}})
        reloaded = self.api('GET', '/attempts/' + attempt_id, 'student')
        self.assertEqual(len(reloaded['answers']), 2)
        self.api('POST', f'/attempts/{attempt_id}/submit', 'student')
        self.api('POST', f'/attempts/{attempt_id}/submit', 'student')
        with SessionLocal() as db:
            answer = db.scalar(select(Answer).where(Answer.attempt_id == UUID(attempt_id), Answer.question_id == UUID(questions[1]['id'])))
            answer_id = str(answer.id)
        for points in (-1, 3):
            self.api('PATCH', f'/answers/{answer_id}/grade', expected=422, json={'points_awarded': points})
        self.api('PATCH', f'/answers/{answer_id}/grade', 'other_teacher', expected=403, json={'points_awarded': 1})
        self.api('PATCH', f'/answers/{answer_id}/grade', 'student', expected=403, json={'points_awarded': 1})
        self.api('PATCH', f'/answers/{answer_id}/grade', json={'points_awarded': 1.5})
        with SessionLocal() as db:
            saved = db.get(ExamAttempt, UUID(attempt_id))
            self.assertEqual(saved.score, Decimal('3.50')); self.assertEqual(saved.max_score, Decimal('4.00'))
        student = self.api('GET', f'/attempts/{attempt_id}/result', 'student')
        teacher = self.api('GET', f'/attempts/{attempt_id}/result')
        self.assertEqual(Decimal(str(student['score'])), Decimal('3.5'))
        self.assertEqual(student['score'], teacher['score'])
        for path in [f'/exams/{exam["id"]}/report', f'/teacher/reports?exam_id={exam["id"]}']:
            report = self.api('GET', path)
            def matching(node):
                if isinstance(node, dict):
                    if str(node.get('id') or node.get('attempt_id')) == attempt_id and 'score' in node:
                        yield node['score']
                    for value in node.values(): yield from matching(value)
                elif isinstance(node, list):
                    for value in node: yield from matching(value)
            scores = list(matching(report))
            self.assertTrue(scores, path)
            self.assertTrue(all(Decimal(str(score)) == Decimal('3.5') for score in scores), path)
        self.api('GET', f'/exams/{exam["id"]}/report', 'other_teacher', expected=403)
        self.api('PATCH', '/exams/' + exam['id'], 'other_teacher', expected=403, json={'title': 'Forbidden edit'})

    def test_recording_snapshot_and_export_are_private(self):
        from app.api import media
        _, _, _, exam, attempt = self.scenario()
        attempt_id = UUID(attempt['id'])
        recording_url = f'/uploads/recordings/{attempt_id}.webm'
        snapshot_name = uuid4().hex + '.png'
        with TemporaryDirectory() as directory, patch.object(media, 'RECORDING_DIR', Path(directory)), patch.object(media, 'UPLOAD_DIR', Path(directory)):
            Path(directory, f'{attempt_id}.webm').write_bytes(b'QA synthetic recording for permission checks')
            Path(directory, snapshot_name).write_bytes(b'QA synthetic snapshot for permission checks')
            with SessionLocal() as db:
                session = ProctoringSession(id=uuid4(), attempt_id=attempt_id, camera_enabled=True, mic_enabled=False, full_recording_url=recording_url)
                db.add(session); db.flush()
                db.add(DetectionEvent(id=uuid4(), proctoring_session_id=session.id, attempt_id=attempt_id,
                    event_type='face_not_detected', confidence_score=Decimal('.1'), severity='low', snapshot_url='/uploads/' + snapshot_name))
                db.commit()
            for path in [recording_url, '/uploads/' + snapshot_name]:
                self.assertEqual(self.client.get(path).status_code, 401)
                for actor in ['student', 'teacher', 'admin']:
                    response = self.client.get(path, headers=self.headers(actor))
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('no-store', response.headers['cache-control'])
                for actor in ['other_student', 'other_teacher']:
                    self.assertIn(self.client.get(path, headers=self.headers(actor)).status_code, (403, 404))
        exported = self.api('POST', f'/exams/{exam["id"]}/report/export?format=csv')
        self.assertEqual(self.client.get(exported['url']).status_code, 401)
        self.assertEqual(self.client.get(exported['url'], headers=self.headers()).status_code, 200)
        self.assertIn(self.client.get(exported['url'], headers=self.headers('other_teacher')).status_code, (403, 404))
        self.assertIn(self.client.get('/uploads/recordings/..%2F..%2F.env', headers=self.headers()).status_code, (404, 422))

    def test_export_csv_and_xlsx_do_not_execute_user_controlled_formula_cells(self):
        import csv
        from io import BytesIO, StringIO
        from openpyxl import load_workbook
        _, _, _, exam, _ = self.scenario()
        student_id = UUID(self.actors['student']['id'])
        with SessionLocal() as db:
            student = db.get(User, student_id); previous = student.full_name
            student.full_name = '=1+1'; db.commit()
        try:
            for extension in ('csv', 'xlsx'):
                exported = self.api('POST', f'/exams/{exam["id"]}/report/export?format={extension}')
                response = self.client.get(exported['url'], headers=self.headers())
                self.assertEqual(response.status_code, 200)
                if extension == 'csv':
                    row = list(csv.DictReader(StringIO(response.content.decode('utf-8-sig'))))[0]
                    self.assertEqual(row['student_name'], "'=1+1")
                else:
                    sheet = load_workbook(BytesIO(response.content), data_only=False).active
                    header = [cell.value for cell in sheet[1]]
                    cell = sheet.cell(2, header.index('student_name') + 1)
                    self.assertEqual(cell.value, "'=1+1")
                    self.assertEqual(cell.data_type, 's')
        finally:
            with SessionLocal() as db:
                db.get(User, student_id).full_name = previous; db.commit()

    def test_profile_phone_and_notification_changes_are_persisted(self):
        student = self.actors['other_student']
        self.api('PATCH', '/auth/me', 'other_student', json={'phone': '0901234567'})
        with SessionLocal() as db:
            self.assertEqual(db.get(User, UUID(student['id'])).phone, '0901234567')
            row = Notification(id=uuid4(), recipient_user_id=UUID(student['id']), type='student_card_notice', title='QA: Profile notice', message='QA persisted notification')
            db.add(row); db.commit(); notification_id = str(row.id)
        page = self.api('GET', '/notifications?limit=8', 'other_student')
        self.assertIn(notification_id, [item['id'] for item in page])
        count = self.api('GET', '/notifications/unread-count', 'other_student')['count']
        self.assertGreaterEqual(count, 1)
        self.api('PATCH', '/notifications/' + notification_id + '/read', 'other_student')
        self.assertEqual(self.api('GET', '/notifications/unread-count', 'other_student')['count'], count - 1)
        self.api('PATCH', '/notifications/read-all', 'other_student')
        self.assertEqual(self.api('GET', '/notifications/unread-count', 'other_student')['count'], 0)

    def test_support_escalation_admin_websocket_reply_and_isolation(self):
        session = self.api('POST', '/support-assistant/sessions', json={'new': True})
        path = '/support-assistant/sessions/' + session['id']
        def command(action, **kwargs):
            return self.api('POST', path + '/turns', json={'client_id': str(uuid4()), 'action': action, **kwargs})
        command('category', value='account')
        guidance = command('topic', value='account-1')
        self.assertIn(guidance['phase'], ('FEEDBACK', 'ESCALATE'))
        if guidance['phase'] == 'FEEDBACK':
            command('unresolved')
        case = command('escalate')
        conversation = case['conversation_id']
        self.assertEqual(case['status'], 'ESCALATED')
        self.assertTrue(case['summary']['articles'])
        self.api('GET', path, 'other_teacher', expected=404)
        response = self.client.get('/api/v1/chat/conversations/' + conversation, headers=self.headers('other_teacher'))
        self.assertIn(response.status_code, (403, 404))
        self.assertIn(conversation, [row['id'] for row in self.api('GET', '/chat/conversations', 'admin')])
        with self.client.websocket_connect('/api/v1/chat/ws') as ws:
            ws.send_json({'type': 'auth', 'token': create_access_token(self.actors['teacher']['id'], 'teacher')})
            self.assertEqual(ws.receive_json()['type'], 'ready')
            reply = self.api('POST', f'/chat/conversations/{conversation}/messages', 'admin',
                json={'client_id': str(uuid4()), 'body': 'QA: Administrator is reviewing the account.'})
            event = ws.receive_json()
            if event['type'] == 'resync':
                event = ws.receive_json()
            self.assertEqual(event['conversation_id'], conversation)
        persisted = self.api('GET', path)
        self.assertEqual(persisted['status'], 'ADMIN_ACTIVE')
        messages = self.api('GET', f'/chat/conversations/{conversation}/messages')
        self.assertIn(reply['id'], [row['id'] for row in messages])
        self.api('POST', f'/chat/conversations/{conversation}/messages', expected=422,
            json={'client_id': str(uuid4()), 'body': '   '})
        command('close')
        self.api('POST', f'/chat/conversations/{conversation}/messages', 'admin', expected=409,
            json={'client_id': str(uuid4()), 'body': 'QA: A closed case cannot accept new messages.'})

    def test_whitespace_oversized_strings_and_invalid_periods_are_rejected(self):
        for path, payload in [('/classes', {'name': '   '}), ('/question-banks', {'name': '   '}), ('/question-banks', {'name': 'x' * 256})]:
            self.api('POST', path, expected=422, json=payload)
        now = datetime.now(timezone.utc)
        self.api('POST', '/exams', expected=422, json={'title': 'QA invalid dates', 'start_time': now.isoformat(), 'end_time': (now - timedelta(minutes=1)).isoformat()})
        cls = self.api('POST', '/classes', json={'name': 'QA valid class ' + uuid4().hex[:8]})
        self.api('PATCH', '/classes/' + cls['id'], expected=422, json={'name': None})
