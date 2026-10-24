from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.responses import ok
from app.api.v1.chat import append_message, event_for
from app.core.config import get_settings
from app.core.database import get_db
from app.models.entities import AttemptStatus, ExamAttempt, SupportConversation, SupportSession, SupportTurn, SupportMessage, User, UserRole
from app.services import support_knowledge as kb, support_realtime as realtime
from app.services.support_assistant_provider import get_support_provider, SupportProviderUnavailable, SupportProviderNotConfigured
from app.services.ai_provider import provider_configured, provider_status, ai_trace
from app.services.ai_metrics import measure
from app.services.audit import record_audit
from app.models.entities import AIActivity

router = APIRouter(prefix='/support-assistant')
ACTIVE = ('AI_ACTIVE', 'ESCALATED', 'ADMIN_ACTIVE')
GREETING = 'Xin chào! Bạn cần hỗ trợ vấn đề nào?'
KNOWLEDGE_NOT_FOUND = 'Tôi chưa tìm thấy hướng dẫn phù hợp cho vấn đề này.'


class Start(BaseModel):
    model_config = ConfigDict(extra='forbid')
    new: bool = False
    client_id: UUID | None = None


class Command(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_id: UUID
    action: Literal['category', 'topic', 'message', 'clarify', 'retry', 'resolved', 'unresolved', 'escalate', 'close', 'reopen']
    text: str = Field(default='', max_length=2000)
    value: str = Field(default='', max_length=80)
    route: str = Field(default='', max_length=160)
    error_code: Literal['STUDENT_CODE_MISMATCH', 'FACE_TOO_SMALL', 'CAMERA_PERMISSION_DENIED'] | None = None

    @field_validator('text', 'value', 'route')
    @classmethod
    def clean(cls, value):
        if '\x00' in value:
            raise ValueError('Invalid text')
        return value.strip()


def exam_guard(db, user):
    if user.role == UserRole.student and db.scalar(select(ExamAttempt.id).where(
            ExamAttempt.student_id == user.id, ExamAttempt.status == AttemptStatus.in_progress,
            ExamAttempt.server_deadline_at > datetime.now(timezone.utc)).limit(1)):
        raise HTTPException(403, detail={'code': 'EXAM_IN_PROGRESS',
            'message': 'Hỗ trợ AI tạm khóa trong khi bạn đang làm bài thi. Hãy tiếp tục bài thi và liên hệ giám thị qua chức năng của kỳ thi.'})


def eligible(user):
    if user.role not in (UserRole.student, UserRole.teacher):
        raise HTTPException(403, 'AI support is for students and teachers')


def owned(db, user, session_id, lock=False):
    query = select(SupportSession).where(SupportSession.id == session_id)
    if user.role != UserRole.admin:
        query = query.where(SupportSession.user_id == user.id, SupportSession.role == user.role.value)
    row = db.scalar(query.with_for_update().execution_options(populate_existing=True) if lock else query)
    if not row or (user.role == UserRole.admin and not row.conversation_id):
        raise HTTPException(404, 'Support session not found')
    return row


def turns(db, row):
    return db.scalars(select(SupportTurn).where(SupportTurn.session_id == row.id)
                      .order_by(SupportTurn.created_at, SupportTurn.id)).all()


def snapshot(db, row):
    category = kb.category_for(row.role, row.category)
    active_articles = {a['id'] for a in kb.articles(db) if a['role'] == row.role and a['is_active']}
    topic = next((item for item in (category or {}).get('topics', []) if item['id'] == row.topic), None)
    return {'id': row.id, 'status': row.status, 'phase': row.phase, 'category': row.category,
        'title': ' · '.join(filter(None, [(category or {}).get('label', 'Vấn đề khác'), (topic or {}).get('label')])),
        'topic': row.topic, 'created_at': row.created_at, 'updated_at': row.updated_at,
        'closed_at': row.closed_at, 'closed_by': row.closed_by,
        'provider_configured': provider_configured(),
        'provider_error': provider_status()['error'],
        'ai_error': row.summary.get('ai_error') if row.phase == 'UNAVAILABLE' else None,
        'support_error': row.summary.get('support_error') if row.phase == 'ESCALATE' else None,
        'conversation_id': row.conversation_id, 'summary': row.summary, 'greeting': GREETING,
        'categories': [{'id': c['id'], 'label': c['label']} for c in kb.categories(row.role)],
        'topics': [{'id': t['id'], 'label': t['label']} for t in (category or {}).get('topics', []) if t['article_id'] in active_articles],
        'messages': [{'id': t.id, 'user_text': t.user_text, 'assistant_text': t.assistant_text,
                      'action': t.action, 'sources': t.sources, 'used_provider': t.used_provider, 'created_at': t.created_at} for t in turns(db, row)]}


def close_session(db, row, actor):
    """Caller holds owner -> conversation -> session locks. Never mark messages read."""
    now = datetime.now(timezone.utc)
    row.status = 'CLOSED'; row.closed_at = now; row.closed_by = actor.id; row.updated_at = now
    admin = actor.role == UserRole.admin
    if admin:
        row.resolved_at = now
    text = 'Quản trị viên đã đánh dấu yêu cầu hỗ trợ là đã giải quyết.' if admin else 'Cuộc trò chuyện đã kết thúc.'
    event = {'type': 'resync', 'session_id': str(row.id), 'recipients': [str(row.user_id)]}
    if row.conversation_id:
        conversation = db.get(SupportConversation, row.conversation_id)
        if conversation.last_message_at:
            last = conversation.last_message_at
            now = max(now, (last.replace(tzinfo=timezone.utc) if last.tzinfo is None else last) + timedelta(microseconds=1))
        db.add(SupportMessage(id=uuid4(), conversation_id=conversation.id, sender_id=actor.id, client_id=uuid4(),
            body=text, kind='system', created_at=now))
        conversation.updated_at = conversation.last_message_at = now
        event = event_for(db, conversation, 'resync')
    realtime.enqueue(db, event)
    return text, event


@router.post('/sessions')
def start(body: Start, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    eligible(user); exam_guard(db, user)
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    if body.client_id:
        previous = db.scalar(select(SupportSession).where(SupportSession.user_id == user.id, SupportSession.start_key == body.client_id))
        if previous:
            if previous.role != user.role.value:
                raise HTTPException(409, 'Retry key belongs to a previous account role')
            result = snapshot(db, previous); db.commit(); return ok(result)
    row = db.scalar(select(SupportSession).where(SupportSession.user_id == user.id, SupportSession.status.in_(ACTIVE))
                    .order_by(SupportSession.created_at.desc(), SupportSession.id.desc()).limit(1))
    if row and row.role == user.role.value and not body.new:
        result = snapshot(db, row); db.commit(); return ok(result)
    recent = db.scalar(select(func.count()).select_from(SupportSession).where(SupportSession.user_id == user.id,
        SupportSession.created_at > datetime.now(timezone.utc) - timedelta(days=1)))
    if recent >= 30:
        raise HTTPException(429, 'Bạn đã tạo nhiều phiên hỗ trợ hôm nay. Vui lòng quay lại phiên gần nhất.')
    event = None
    if row:
        if row.conversation_id:
            db.scalar(select(SupportConversation).where(SupportConversation.id == row.conversation_id).with_for_update())
        row = db.scalar(select(SupportSession).where(SupportSession.id == row.id, SupportSession.user_id == user.id)
                        .with_for_update().execution_options(populate_existing=True))
        _, event = close_session(db, row, user)
        db.flush()
    now = datetime.now(timezone.utc)
    row = SupportSession(id=uuid4(), user_id=user.id, role=user.role.value, status='AI_ACTIVE', phase='CATEGORY', summary={}, start_key=body.client_id, created_at=now, updated_at=now)
    db.add(row); db.commit()
    if event:
        background_tasks.add_task(realtime.after_commit, db, event)
    return ok(snapshot(db, row))


@router.get('/sessions')
def history(cursor: UUID | None = None, limit: int = Query(30, ge=1, le=100),
            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    eligible(user); exam_guard(db, user)
    query = select(SupportSession).where(SupportSession.user_id == user.id, SupportSession.role == user.role.value)
    if cursor:
        anchor = owned(db, user, cursor)
        query = query.where((SupportSession.created_at < anchor.created_at) |
            ((SupportSession.created_at == anchor.created_at) & (SupportSession.id < anchor.id)))
    rows = db.scalars(query.order_by(SupportSession.created_at.desc(), SupportSession.id.desc()).limit(limit + 1)).all()
    conversation_ids = [row.conversation_id for row in rows[:limit] if row.conversation_id]
    unread = dict(db.execute(select(SupportMessage.conversation_id, func.count()).where(
        SupportMessage.conversation_id.in_(conversation_ids), SupportMessage.read_at.is_(None),
        SupportMessage.sender_id != user.id, SupportMessage.kind != 'system').group_by(SupportMessage.conversation_id)).all()) if conversation_ids else {}
    items = []
    for row in rows[:limit]:
        category = kb.category_for(row.role, row.category)
        topic = next((item for item in (category or {}).get('topics', []) if item['id'] == row.topic), None)
        items.append({'id': row.id, 'status': row.status, 'title': ' · '.join(filter(None, [(category or {}).get('label', 'Vấn đề khác'), (topic or {}).get('label')])),
            'created_at': row.created_at, 'updated_at': row.updated_at, 'closed_at': row.closed_at, 'unread_count': unread.get(row.conversation_id, 0)})
    return {'data': items, 'meta': {'next_cursor': str(rows[limit - 1].id) if len(rows) > limit else None}}


@router.get('/sessions/{session_id}')
def get_session(session_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    exam_guard(db, user)
    return ok(snapshot(db, owned(db, user, session_id)))


def answer_from_articles(row, articles):
    articles = [a for a in articles if a]
    sources = [kb.public_source(a) for a in articles]
    needs_admin = any(a['requires_admin'] for a in articles)
    if not sources:
        row.phase = 'ESCALATE'
        row.summary = {**row.summary, 'support_error': {'code': 'SUPPORT_KNOWLEDGE_NOT_FOUND', 'message': KNOWLEDGE_NOT_FOUND}}
        return KNOWLEDGE_NOT_FOUND, []
    row.phase = 'ESCALATE' if needs_admin else 'FEEDBACK'
    text = '\n\n'.join(a['title'] + '\n' + '\n'.join(f'{i + 1}. {s}' for i, s in enumerate(a['steps'])) for a in articles)
    text += ('\n\nVấn đề này cần quản trị viên hệ thống kiểm tra.' if needs_admin
             else '\n\nBạn thử các bước trên xem vấn đề đã được giải quyết chưa.')
    return text, sources


def provider_answer(db, row, query, body):
    row.summary = {key: value for key, value in row.summary.items() if key not in ('ai_error', 'support_error')}
    if kb.is_greeting(query):
        row.phase = 'CATEGORY'; row.category = None; row.topic = None
        ai_trace('support_greeting', feature='support', provider_called=False, support_retrieval_count=0)
        return 'Xin chào! Bạn cần hỗ trợ vấn đề nào?', [], False
    category = kb.infer_category(row.role, query)
    if category:
        row.category = category; row.topic = None
    articles = kb.retrieve(row.role, row.category, query + (' ' + body.error_code if body.error_code else ''), db=db)
    # Only reviewed KB references, never the prompt or provider response.
    retrieved = {a['id']: a for a in row.summary.get('retrieved_articles', [])}
    retrieved.update({a['id']: {'id': a['id'], 'title': a['title'], 'route': a['route']} for a in articles})
    row.summary = {**row.summary, 'retrieved_articles': list(retrieved.values())}
    ai_trace('support_retrieval', feature='support', role=row.role, category=row.category,
             support_retrieval_count=len(articles), provider_called=False,
             retrieved_articles=kb.retrieve(row.role, row.category, query + (' ' + body.error_code if body.error_code else ''), db=db, with_scores=True))
    text = kb.normalize(query)
    if row.role == 'student' and any(k in text for k in ('tao de thi', 'tao cau hoi', 'ngan hang cau hoi')):
        row.phase = 'ESCALATE'
        return 'Tài khoản sinh viên không có quyền tạo đề thi hoặc quản lý ngân hàng câu hỏi.', [], False
    if row.role == 'teacher' and 'the sinh vien' in text:
        row.phase = 'ESCALATE'
        return 'Xác thực thẻ sinh viên thuộc luồng của sinh viên và quản trị viên. Tài khoản giảng viên không xác thực thẻ thay sinh viên.', [], False
    if any(k in text for k in ('van gap loi', 'van khong duoc', 'khong giai quyet', 'da thu nhieu lan')) and any(t.sources for t in turns(db, row)):
        row.phase = 'ESCALATE'
        row.summary = {**row.summary, 'confirmed_unresolved': True}
        return 'Bạn vẫn gặp lỗi sau khi thử hướng dẫn. Vấn đề này cần quản trị viên hệ thống kiểm tra.', [], False
    immediate = [a for a in articles if a['requires_admin']]
    if immediate or not articles:
        answer, sources = answer_from_articles(row, immediate)
        return answer, sources, False
    settings = get_settings()
    now = datetime.now(timezone.utc)
    for since, limit in ((now - timedelta(minutes=1), settings.SUPPORT_AI_PER_MINUTE), (now - timedelta(days=1), settings.SUPPORT_AI_PER_DAY)):
        count = db.scalar(select(func.count()).select_from(SupportTurn).join(SupportSession).where(
            SupportSession.user_id == row.user_id, SupportTurn.used_provider.is_(True), SupportTurn.created_at > since))
        if count >= limit:
            row.phase = 'UNAVAILABLE'
            row.summary = {**row.summary, 'ai_error': {'code': 'AI_RATE_LIMITED', 'message': 'Đã đạt giới hạn AI tạm thời. Vui lòng thử lại sau.'}}
            return 'Đã đạt giới hạn AI tạm thời. Vui lòng thử lại sau. Bạn có thể liên hệ System Admin để được hỗ trợ.', [], False
    # Only an allowlisted, query-free help route may enter provider context.
    route = body.route.split('?')[0].split('#')[0]
    if route not in {a['route'].split('?')[0].split('#')[0] for a in kb.articles(db) if a['role'] == row.role and a['is_active']}:
        route = ''
    try:
        selected = get_support_provider().answer(role=row.role, category=row.category, query=kb.redact(query),
            sources=articles, route=route, error_code=body.error_code)
        # Validate again at the abstraction boundary (including alternative adapters).
        if set(selected.article_ids) - {a['id'] for a in articles}:
            raise SupportProviderUnavailable()
        chosen = [a for a in articles if a['id'] in selected.article_ids]
        ai_trace('support_selection', feature='support', selected_count=len(chosen), parse_success=True, selected_article_ids=[a['id'] for a in chosen])
        answer, sources = answer_from_articles(row, chosen)
        if selected.needs_admin:
            row.phase = 'ESCALATE'
            answer = KNOWLEDGE_NOT_FOUND if not chosen else answer + '\n\nBạn có thể chuyển yêu cầu tới quản trị viên.'
        return answer, sources, True
    except SupportProviderNotConfigured as exc:
        row.phase = 'UNAVAILABLE'
        row.summary = {**row.summary, 'ai_error': {'code': exc.code, 'message': 'Trợ lý AI hiện chưa được cấu hình'}}
        return 'Trợ lý AI hiện chưa được cấu hình', [], True
    except SupportProviderUnavailable as exc:
        row.phase = 'UNAVAILABLE'
        row.summary = {**row.summary, 'ai_error': {'code': exc.code, 'message': exc.message}}
        return exc.message + ' Bạn có thể liên hệ System Admin để được hỗ trợ.', [], True


def build_summary(db, row):
    history = turns(db, row)
    category = kb.category_for(row.role, row.category)
    issues = [kb.redact(t.user_text) for t in history if t.action in ('topic', 'message') and t.user_text and not kb.is_greeting(t.user_text)]
    steps = list(dict.fromkeys(step for t in history for source in t.sources for step in source['steps']))
    confirmed = bool(row.summary.get('confirmed_unresolved'))
    error = row.summary.get('ai_error') if row.phase == 'UNAVAILABLE' else None
    error = error or provider_status()['error']
    owner = db.get(User, row.user_id)
    topic = next((item for item in (category or {}).get('topics', []) if item['id'] == row.topic), None)
    articles = {a['id']: {'id': a['id'], 'title': a['title'], 'route': a['route']} for t in history for a in t.sources}
    articles.update({a['id']: a for a in row.summary.get('retrieved_articles', [])})
    return {'user_name': owner.full_name, 'role': row.role, 'student_code': owner.student_code,
        'category': (category or {}).get('label', 'Vấn đề khác'), 'subcategory': (topic or {}).get('label'),
        'articles': list(articles.values()), 'issue': '\n'.join(issues) or 'Người dùng yêu cầu hỗ trợ thêm.',
        'steps': steps, 'confirmed_unresolved': confirmed,
        'result': 'Người dùng xác nhận vẫn gặp lỗi.' if confirmed else (
            error['message'] + ' Người dùng yêu cầu chuyển quản trị viên.' if error else
            'Trợ lý AI không khả dụng; người dùng yêu cầu chuyển quản trị viên.' if row.phase == 'UNAVAILABLE'
            else 'Vấn đề ngoài phạm vi tự hỗ trợ; người dùng yêu cầu quản trị viên kiểm tra.')}


@router.post('/sessions/{session_id}/turns')
def command(session_id: UUID, body: Command, background_tasks: BackgroundTasks,
            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    exam_guard(db, user)
    # Consistent owner -> conversation -> session locking also serializes AI quotas
    # across sessions and workers. No process-local counters or client role claims.
    initial = owned(db, user, session_id)
    db.scalar(select(User).where(User.id == initial.user_id).with_for_update())
    if initial.conversation_id:
        db.scalar(select(SupportConversation).where(SupportConversation.id == initial.conversation_id).with_for_update())
    row = owned(db, user, session_id, lock=True)
    fingerprint = hashlib.sha256(json.dumps(body.model_dump(mode='json', exclude={'client_id'}), sort_keys=True).encode()).hexdigest()
    previous = db.scalar(select(SupportTurn).where(SupportTurn.session_id == row.id, SupportTurn.client_id == body.client_id))
    if previous:
        if previous.request_hash != fingerprint:
            raise HTTPException(409, 'Retry key already used')
        result = snapshot(db, row); db.commit(); return ok(result)
    if user.role == UserRole.admin and body.action != 'close':
        raise HTTPException(403, 'Administrators may only resolve escalated cases')
    if row.status not in ACTIVE:
        if body.action == 'close' and row.status == 'CLOSED':
            result = snapshot(db, row); db.commit(); return ok(result)
        raise HTTPException(409, detail={'code': 'SUPPORT_SESSION_CLOSED', 'message': 'Cuộc trò chuyện này đã kết thúc. Hãy bắt đầu cuộc trò chuyện mới.'})
    user_text = kb.redact(body.text)
    answer, sources, used_provider, event = '', [], False, None
    if body.action == 'close':
        answer, event = close_session(db, row, user)
    elif body.action == 'reopen':
        raise HTTPException(409, detail={'code': 'SUPPORT_SESSION_CLOSED', 'message': 'Hãy bắt đầu cuộc trò chuyện mới để tiếp tục hỗ trợ.'})
    else:
        if row.status != 'AI_ACTIVE':
            raise HTTPException(409, 'This AI session has ended')
        history = turns(db, row)
        if body.action in ('message', 'topic', 'category', 'retry') and len(history) >= 100:
            row.phase = 'ESCALATE'; answer = 'Phiên hỗ trợ đã có nhiều trao đổi. Bạn có thể chuyển quản trị viên để kiểm tra thêm.'
        elif body.action == 'category':
            category = kb.category_for(row.role, body.value)
            if not category:
                raise HTTPException(422, 'Category not available for your role')
            row.category = body.value; row.topic = None; row.phase = 'DETAIL'
            user_text = category['label']; answer = 'Bạn đang gặp vấn đề gì? Chọn nội dung bên dưới hoặc mô tả chi tiết.'
        elif body.action == 'clarify':
            if row.summary.get('support_error', {}).get('code') != 'SUPPORT_KNOWLEDGE_NOT_FOUND' or row.phase != 'ESCALATE':
                raise HTTPException(409, 'No missing guidance to clarify')
            row.summary = {key: value for key, value in row.summary.items() if key != 'support_error'}
            row.phase = 'DETAIL'
            user_text = 'Thử mô tả chi tiết hơn'
            answer = 'Bạn đang ở màn hình nào, vừa thực hiện thao tác gì và gặp thông báo lỗi nào? Không gửi mật khẩu hoặc dữ liệu đề thi.'
        elif body.action == 'topic':
            category = kb.category_for(row.role, row.category)
            topic = next((t for t in (category or {}).get('topics', []) if t['id'] == body.value), None)
            if not topic:
                raise HTTPException(422, 'Invalid support topic')
            row.topic = topic['id']; user_text = topic['label']
            answer, sources = answer_from_articles(row, [kb.article_for(row.role, topic['article_id'], db=db)])
        elif body.action in ('message', 'retry'):
            if not row.category and body.action == 'message' and not kb.is_greeting(user_text):
                row.category = kb.infer_category(row.role, user_text) or 'other'
            if body.action == 'retry':
                if row.phase != 'UNAVAILABLE':
                    raise HTTPException(409, 'No failed AI request to retry')
                original = next((t for t in reversed(history) if t.action == 'message'), None)
                if not original:
                    raise HTTPException(409, 'No question to retry')
                query = original.user_text; user_text = 'Thử lại trợ lý AI'
            else:
                if not user_text:
                    raise HTTPException(422, 'Enter a support question')
                query = user_text
            with measure() as metrics:
                answer, sources, used_provider = provider_answer(db, row, query, body)
            metrics.update(success=row.phase != 'UNAVAILABLE', error_code=(row.summary.get('ai_error') or {}).get('code'),
                kb_miss=(row.summary.get('support_error') or {}).get('code') == 'SUPPORT_KNOWLEDGE_NOT_FOUND')
            db.add(AIActivity(id=uuid4(), feature='support', actor_id=user.id, session_id=row.id,
                role=row.role, category=row.category, metrics=metrics, created_at=datetime.now(timezone.utc)))
            exam_guard(db, user)  # An attempt may have started while the provider was running.
        elif body.action in ('resolved', 'unresolved'):
            if row.phase != 'FEEDBACK':
                raise HTTPException(409, 'There is no guidance awaiting feedback')
            if body.action == 'resolved':
                row.status = 'RESOLVED_BY_AI'; row.resolved_at = datetime.now(timezone.utc)
                user_text = 'Đã giải quyết'; answer = 'Vấn đề đã được đánh dấu là đã giải quyết.'
                event = {'type': 'resync', 'session_id': str(row.id), 'recipients': [str(row.user_id)]}
                realtime.enqueue(db, event)
            else:
                row.phase = 'ESCALATE'; row.summary = {**row.summary, 'confirmed_unresolved': True}
                user_text = 'Vẫn gặp lỗi'; answer = 'Vấn đề này cần quản trị viên hệ thống kiểm tra thêm.'
        elif body.action == 'escalate':
            if row.phase not in ('ESCALATE', 'UNAVAILABLE') and provider_configured():
                raise HTTPException(409, 'Try support guidance before escalating')
            row.summary = build_summary(db, row)
            conversation = SupportConversation(id=uuid4(), owner_id=user.id); db.add(conversation); db.flush()
            row.conversation_id = conversation.id; row.status = 'ESCALATED'; row.escalated_at = datetime.now(timezone.utc)
            record_audit(db, action='AI_SUPPORT_ESCALATED', user_id=user.id, entity_type='support_session', entity_id=row.id,
                metadata={'role': row.role, 'category': row.category})
            user_text = 'Liên hệ System Admin'; answer = 'Yêu cầu của bạn đã được chuyển đến quản trị viên hệ thống.'
            summary_text = (f'{user.full_name}\n' + ('Sinh viên' if row.role == 'student' else 'Giảng viên')
                + (f' · {user.student_code}' if user.student_code else '') + '\n\nChủ đề: ' + row.summary['category']
                + '\nVấn đề: ' + row.summary['issue'][:1600] + '\nHướng dẫn đã thử:\n'
                + '\n'.join('- ' + step for step in row.summary['steps'])[:1500] + '\nKết quả: ' + row.summary['result'])
            _, event = append_message(db, conversation, user, summary_text[:4000], body.client_id, kind='case_summary')
    row.updated_at = datetime.now(timezone.utc)
    # Monotonic ordering avoids same-tick/reversed-clock history reordering.
    last = db.scalar(select(SupportTurn.created_at).where(SupportTurn.session_id == row.id)
                     .order_by(SupportTurn.created_at.desc()).limit(1))
    created = row.updated_at
    if last:
        created = max(created, (last.replace(tzinfo=timezone.utc) if last.tzinfo is None else last) + timedelta(microseconds=1))
    db.add(SupportTurn(id=uuid4(), session_id=row.id, client_id=body.client_id, request_hash=fingerprint,
        action=body.action, user_text=user_text, assistant_text=answer, sources=sources, used_provider=used_provider, created_at=created))
    db.commit()
    if event:
        background_tasks.add_task(realtime.after_commit, db, event)
    return ok(snapshot(db, row))
