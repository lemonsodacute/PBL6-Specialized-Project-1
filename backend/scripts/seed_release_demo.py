"""Create explicitly labelled demo data through real APIs in the isolated QA DB.

Run with scripts/release_qa_runtime.py. No biometric verification is fabricated.
Credentials are generated once and written only to ignored private storage.
"""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import secrets
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.entities import Answer, User, UserRole

OUTPUT = Path(__file__).resolve().parents[1] / 'private' / 'release-qa' / 'demo-accounts.json'


def run():
    if not re.fullmatch(r'ai_procto_release_qa_[0-9a-f]{16}', make_url(settings.DATABASE_URL).database or ''):
        raise RuntimeError('Demo seed requires the isolated release QA database')
    if OUTPUT.exists():
        print('DEMO seed already exists; private credentials retained.')
        return
    password = secrets.token_urlsafe(20) + '!aA1'
    actors = {}
    with SessionLocal() as db:
        for role in ('admin', 'teacher', 'student'):
            user = User(id=uuid4(), full_name='DEMO ' + role.title(), email=f'demo-{role}@example.com',
                password_hash=hash_password(password), role=UserRole(role), is_active=True)
            db.add(user); db.flush()
            actors[role] = {'id': str(user.id), 'email': user.email, 'password': password, 'role': role}
        db.commit()
    with TestClient(app, client=('127.0.0.1', 50000)) as client:
        def api(method, path, actor='teacher', **kwargs):
            response = client.request(method, '/api/v1' + path, headers={'Authorization': 'Bearer ' +
                create_access_token(actors[actor]['id'], actor)}, **kwargs)
            if response.status_code >= 400:
                raise RuntimeError(f'Demo seed stopped at {method} {path}: HTTP {response.status_code}')
            return response.json()['data']
        cls = api('POST', '/classes', json={'name': 'DEMO - Web Fundamentals', 'description': 'Explicit release/demo seed'})
        api('POST', f'/classes/{cls["id"]}/enrollments', json={'student_id': actors['student']['id']})
        bank = api('POST', '/question-banks', json={'name': 'DEMO - HTTP and Web', 'subject': 'Web Fundamentals'})
        single = api('POST', f'/question-banks/{bank["id"]}/questions', json={'question_bank_id': bank['id'], 'type': 'mcq_single',
            'content': 'Which protocol transfers web resources between a client and a server?', 'default_points': 2,
            'options_json': {'options': [{'id': 'a', 'text': 'HTTP'}, {'id': 'b', 'text': 'SQL'}]},
            'correct_answer_json': {'correct_option_id': 'a'}, 'topic': 'HTTP'})
        essay = api('POST', f'/question-banks/{bank["id"]}/questions', json={'question_bank_id': bank['id'], 'type': 'essay',
            'content': 'Explain how HTML and CSS work together on a web page.', 'default_points': 2, 'topic': 'HTML/CSS'})
        now = datetime.now(timezone.utc)
        exams = {}
        for label in ('Completed example', 'Practice now', 'Upcoming exam'):
            future = label == 'Upcoming exam'
            exam = api('POST', '/exams', json={'title': 'DEMO - ' + label, 'description': 'Explicit release/demo seed',
                'start_time': (now + timedelta(days=1) if future else now - timedelta(minutes=5)).isoformat(),
                'end_time': (now + timedelta(days=2)).isoformat(), 'duration_minutes': 20, 'allow_review': True,
                'require_camera': False, 'require_mic': False, 'require_fullscreen': False})
            for index, question in enumerate((single, essay)):
                api('POST', f'/exams/{exam["id"]}/questions', json={'question_id': question['id'], 'order_index': index, 'points': 2})
            api('POST', '/exam-assignments?exam_id=' + exam['id'], json={'class_id': cls['id']})
            api('PATCH', '/exams/' + exam['id'], json={'status': 'published'})
            exams[label] = exam['id']
        attempt = api('POST', '/attempts', 'student', json={'exam_id': exams['Completed example']})
        for question, answer in [(single, {'selected_option_id': 'a'}), (essay, {'text': 'HTML provides structure and CSS controls presentation.'})]:
            api('POST', f'/attempts/{attempt["id"]}/answers', 'student', json={'question_id': question['id'], 'answer_content': answer})
        api('POST', f'/attempts/{attempt["id"]}/submit', 'student')
        with SessionLocal() as db:
            from uuid import UUID
            answer_id = str(db.scalar(select(Answer.id).where(Answer.attempt_id == UUID(attempt['id']), Answer.question_id == UUID(essay['id']))))
        api('PATCH', '/answers/' + answer_id + '/grade', json={'points_awarded': 1.5})
        support = api('POST', '/support-assistant/sessions', json={'new': True})
        for action, extra in [('category', {'value': 'account'}), ('topic', {'value': 'account-1'})]:
            support = api('POST', f'/support-assistant/sessions/{support["id"]}/turns', json={'client_id': str(uuid4()), 'action': action, **extra})
        if support['phase'] == 'FEEDBACK':
            support = api('POST', f'/support-assistant/sessions/{support["id"]}/turns', json={'client_id': str(uuid4()), 'action': 'unresolved'})
        support = api('POST', f'/support-assistant/sessions/{support["id"]}/turns', json={'client_id': str(uuid4()), 'action': 'escalate'})
        api('POST', '/chat/conversations/' + support['conversation_id'] + '/messages', 'admin',
            json={'client_id': str(uuid4()), 'body': 'DEMO - Your support request has reached the administrator.'})
        live = api('POST', '/live-classes', json={'class_id': cls['id'], 'title': 'DEMO - Web review session',
            'scheduled_start': (now + timedelta(hours=1)).isoformat(), 'scheduled_end': (now + timedelta(hours=2)).isoformat()})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({'database': make_url(settings.DATABASE_URL).database, 'actors': actors,
        'class_id': cls['id'], 'bank_id': bank['id'], 'exams': exams, 'completed_attempt_id': attempt['id'],
        'support_session_id': support['id'], 'conversation_id': support['conversation_id'], 'live_class_id': live['id']}, indent=2), encoding='utf-8')
    print('DEMO seed complete: 3 roles, class, bank, 3 exams, graded attempt, support conversation, notifications, scheduled live class.')
    print('Generated credentials: backend/private/release-qa/demo-accounts.json (not printed).')


if __name__ == '__main__':
    run()
