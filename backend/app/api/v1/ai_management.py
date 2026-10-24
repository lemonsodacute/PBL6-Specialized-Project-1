"""Admin KB and metadata-only evaluation. No private AI payload export."""
import csv
from datetime import date, datetime, time, timedelta, timezone
from io import StringIO
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, or_
from sqlalchemy.orm import Session
from app.api.deps import roles
from app.api.responses import ok
from app.core.config import get_settings
from app.core.database import get_db
from app.models.entities import SupportArticle, AIActivity, AIDraftReview, SupportSession, SupportTurn, User, UserRole
from app.services import support_knowledge as kb
from app.services.ai_provider import provider_status, provider_name, model_for, is_configured_value
from app.services.audit import record_audit

router = APIRouter()
admin = roles(UserRole.admin)


class ArticleInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=200)
    role: Literal['student', 'teacher']
    category: str = Field(max_length=40)
    content: str = Field(min_length=10, max_length=12000)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    route: str = Field(default='', max_length=160)
    is_active: bool = True
    requires_admin: bool = False

    @model_validator(mode='after')
    def safe_article(self):
        if not kb.category_for(self.role, self.category):
            raise ValueError('Invalid role/category')
        if any(not k.strip() or len(k) > 80 for k in self.keywords):
            raise ValueError('Keywords must contain 1–80 characters')
        text = '\n'.join([self.title, self.content, *self.keywords])
        if kb.redact(text) != text or any(s in kb.normalize(text) for s in ('system prompt', 'system_prompt', 'api_key=', 'api key:', '-----begin private key')):
            raise ValueError('Không nhập API key, system prompt hoặc thông tin bí mật vào Knowledge Base.')
        allowed = {a['route'] for a in kb.knowledge()['articles'] if a['role'] == self.role}
        if self.route and self.route not in allowed:
            raise ValueError('Chọn đường dẫn hỗ trợ có sẵn cho role này.')
        return self


def article_json(row, db):
    editor = db.get(User, row.updated_by) if row.updated_by else None
    return {**{k: getattr(row, k) for k in ('id', 'title', 'role', 'category', 'content', 'keywords', 'route', 'is_active', 'requires_admin', 'updated_at')},
        'updated_by': editor.full_name if editor else None}


@router.get('/admin/ai-support/articles')
def list_articles(q: str = '', role: Literal['student', 'teacher'] | None = None, category: str = '',
                  active: bool | None = None, db: Session = Depends(get_db), user=Depends(admin)):
    query = select(SupportArticle)
    if q.strip():
        pattern = '%' + q.strip()[:200].replace('%', r'\%').replace('_', r'\_') + '%'
        query = query.where(or_(SupportArticle.title.ilike(pattern, escape='\\'), SupportArticle.content.ilike(pattern, escape='\\')))
    if role: query = query.where(SupportArticle.role == role)
    if category: query = query.where(SupportArticle.category == category)
    if active is not None: query = query.where(SupportArticle.is_active == active)
    return ok({'articles': [article_json(a, db) for a in db.scalars(query.order_by(SupportArticle.updated_at.desc(), SupportArticle.id)).all()],
        'categories': {r: kb.categories(r) for r in ('student', 'teacher')},
        'routes': {r: sorted({a['route'] for a in kb.knowledge()['articles'] if a['role'] == r}) for r in ('student', 'teacher')}})


@router.post('/admin/ai-support/articles')
def create_article(body: ArticleInput, db: Session = Depends(get_db), user=Depends(admin)):
    row = SupportArticle(id=str(uuid4()), **body.model_dump(), updated_by=user.id, updated_at=datetime.now(timezone.utc))
    db.add(row)
    record_audit(db, action='SUPPORT_ARTICLE_CREATED', user_id=user.id, entity_type='support_article',
        metadata={'article_id': row.id, 'role': row.role, 'category': row.category})
    db.commit()
    return ok(article_json(row, db))


@router.put('/admin/ai-support/articles/{article_id}')
def update_article(article_id: str, body: ArticleInput, db: Session = Depends(get_db), user=Depends(admin)):
    row = db.scalar(select(SupportArticle).where(SupportArticle.id == article_id).with_for_update())
    if row is None: raise HTTPException(404, 'Article not found')
    disabled = row.is_active and not body.is_active
    for key, value in body.model_dump().items(): setattr(row, key, value)
    row.updated_by = user.id; row.updated_at = datetime.now(timezone.utc)
    record_audit(db, action='SUPPORT_ARTICLE_DISABLED' if disabled else 'SUPPORT_ARTICLE_UPDATED', user_id=user.id,
        entity_type='support_article', metadata={'article_id': row.id, 'role': row.role, 'category': row.category})
    db.commit()
    return ok(article_json(row, db))


class DebugQuery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    role: Literal['student', 'teacher']
    category: str = ''
    query: str = Field(min_length=1, max_length=2000)


@router.post('/admin/ai-support/retrieval-debug')
def retrieval_debug(body: DebugQuery, db: Session = Depends(get_db), user=Depends(admin)):
    if get_settings().ENVIRONMENT not in ('development', 'dev', 'local', 'test'): raise HTTPException(404)
    return ok({'ranked': kb.retrieve(body.role, body.category, kb.redact(body.query), db=db, with_scores=True),
        'score_type': 'lexical_relevance', 'selected_article_ids': None, 'provider_called': False})


@router.get('/admin/ai-support/retrieval-debug/recent')
def recent_retrieval(db: Session = Depends(get_db), user=Depends(admin)):
    if get_settings().ENVIRONMENT not in ('development', 'dev', 'local', 'test'): raise HTTPException(404)
    rows = db.scalars(select(AIActivity).where(AIActivity.feature == 'support').order_by(AIActivity.created_at.desc()).limit(20)).all()
    return ok([{'id': r.id, 'timestamp': r.created_at, 'role': r.role, 'category': r.category,
        'retrieved': r.metrics.get('retrieved_articles', []), 'selected': r.metrics.get('selected_article_ids', [])} for r in rows])


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    decision: Literal['accepted', 'edited', 'rejected'] | None = None
    quality_rating: int | None = Field(default=None, ge=1, le=5, strict=True)
    reason: Literal['wrong_answer', 'ungrounded', 'ambiguous', 'weak_distractors', 'wrong_difficulty', 'weak_explanation', 'wording', 'other'] | None = None
    reason_note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode='after')
    def nonempty_update(self):
        if not self.model_fields_set:
            raise ValueError('Cần chọn đánh giá hoặc cập nhật lý do.')
        return self


def feedback_json(row):
    return {key: getattr(row, key) for key in ('decision', 'quality_rating', 'reason', 'reason_note')}


@router.put('/question-banks/{bank_id}/documents/{document_id}/drafts/{draft_id}/feedback')
def feedback(bank_id: UUID, document_id: UUID, draft_id: UUID, body: ReviewInput,
             db: Session = Depends(get_db), user=Depends(roles(UserRole.teacher, UserRole.admin))):
    from app.api.v1.question_documents import require_bank, require_editable
    from app.services import question_document_drafts as storage
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id) as session:
        require_editable(session)
        if str(draft_id) not in {d['id'] for d in session['questions']}: raise HTTPException(404)
        row = db.scalar(select(AIDraftReview).join(AIActivity).where(AIDraftReview.document_id == document_id,
            AIDraftReview.draft_id == draft_id).order_by(AIActivity.created_at.desc(), AIActivity.id.desc()).limit(1).with_for_update())
        if row is None: raise HTTPException(409, 'Bản nháp chưa có dữ liệu đánh giá. Hãy tạo bản nháp AI mới.')
        updates = body.model_dump(exclude_unset=True)
        reason = updates.get('reason', row.reason)
        if reason != 'other':
            if updates.get('reason_note'):
                raise HTTPException(422, 'Ghi chú lý do chỉ dùng khi chọn Khác.')
            updates['reason_note'] = None
        for key, value in updates.items():
            setattr(row, key, value)
        row.reviewer_id = user.id; row.updated_at = datetime.now(timezone.utc)
        db.commit()
        return ok(feedback_json(row))


@router.get('/question-banks/{bank_id}/documents/{document_id}/feedback')
def review_feedback(bank_id: UUID, document_id: UUID, db: Session = Depends(get_db), user=Depends(roles(UserRole.teacher, UserRole.admin))):
    from app.api.v1.question_documents import require_bank
    from app.services import question_document_drafts as storage
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id):
        rows = db.scalars(select(AIDraftReview).join(AIActivity).where(AIDraftReview.document_id == document_id)
            .order_by(AIActivity.created_at, AIActivity.id)).all()
        return ok({str(r.draft_id): feedback_json(r) for r in rows})


def bounds(start: date | None, end: date | None):
    end = end or datetime.now(timezone.utc).date()
    start = start or end - timedelta(days=6)
    if start > end or (end - start).days > 366: raise HTTPException(422, 'Chọn khoảng ngày tối đa 367 ngày.')
    return datetime.combine(start, time.min, timezone.utc), datetime.combine(end + timedelta(days=1), time.min, timezone.utc)


def ratio(numerator, denominator):
    return {'numerator': numerator, 'denominator': denominator, 'rate': numerator / denominator if denominator else None}


def dataset(db, start, end):
    rows = db.scalars(select(AIActivity).where(AIActivity.created_at >= start, AIActivity.created_at < end).order_by(AIActivity.created_at)).all()
    reviews = db.scalars(select(AIDraftReview).join(AIActivity).where(AIActivity.created_at >= start, AIActivity.created_at < end)).all()
    sessions = db.scalars(select(SupportSession).where(SupportSession.created_at >= start, SupportSession.created_at < end).order_by(SupportSession.created_at)).all()
    turns = db.scalars(select(SupportTurn).join(SupportSession).where(SupportSession.created_at >= start, SupportSession.created_at < end,
        SupportTurn.action.in_(['resolved', 'unresolved']))).all()
    return rows, reviews, sessions, turns


def summarize(db, start, end):
    rows, reviews, sessions, turns = dataset(db, start, end)
    question = [r.metrics for r in rows if r.feature == 'question']; support = [r.metrics for r in rows if r.feature == 'support']
    reviewed = [r for r in reviews if r.decision]; decisions = {v: sum(r.decision == v for r in reviewed) for v in ('accepted', 'edited', 'rejected')}
    ratings = [r.quality_rating for r in reviews if r.quality_rating is not None]
    avg = lambda values: round(sum(v['latency_ms'] for v in values) / len(values), 2) if values else None
    total = lambda values, key: sum(v.get(key, 0) or 0 for v in values)
    resolved = {t.session_id for t in turns if t.action == 'resolved'}
    escalated = sum(s.escalated_at is not None for s in sessions)
    helpful = sum(t.action == 'resolved' for t in turns)
    retrieved = [m for m in support if 'retrieval_count' in m]
    return {'start': start, 'end_exclusive': end, 'timezone': 'UTC',
        'question': {'requests': len(question), 'success': sum(bool(m.get('success')) for m in question),
            'failures': sum(not m.get('success') for m in question),
            **{k: total(question, k) for k in ('requested_questions', 'generated_questions', 'grounded_questions', 'questions_with_source', 'image_questions', 'provider_failure_count', 'retry_count')},
            'image_analysis_success': None,
            'structured_parse_success_rate': ratio(sum(m.get('structured_parse_success') is True for m in question), len(question)),
            'average_latency_ms': avg(question), 'reviewed': len(reviewed), **decisions,
            'average_teacher_rating': round(sum(ratings) / len(ratings), 2) if ratings else None,
            'teacher_rating_count': len(ratings),
            'acceptance_rate': ratio(decisions['accepted'], len(reviewed)), 'edit_rate': ratio(decisions['edited'], len(reviewed)),
            'reject_rate': ratio(decisions['rejected'], len(reviewed)), 'insufficient_reviewed_samples': len(reviewed) < 30},
        'support': {'sessions': len(sessions), 'resolved_by_ai_count': len(resolved), 'escalated_count': escalated,
            'escalation_rate': ratio(escalated, len(sessions)), 'retrieval_hit_rate': ratio(sum(m['retrieval_count'] > 0 for m in retrieved), len(retrieved)),
            'provider_failure_count': total(support, 'provider_failure_count'), 'kb_not_found_count': sum(bool(m.get('kb_miss')) for m in support),
            'average_response_latency_ms': avg(support), 'helpful_rate': ratio(helpful, len(turns))},
        'rate_limit_errors': sum(m.metrics.get('last_error_code') == 'AI_RATE_LIMITED' or m.metrics.get('error_code') == 'AI_RATE_LIMITED' for m in rows)}


@router.get('/admin/ai-support/activity')
def activity(start: date | None = None, end: date | None = None, db: Session = Depends(get_db), user=Depends(admin)):
    begin, finish = bounds(start, end)
    result = summarize(db, begin, finish)
    successful = db.scalar(select(AIActivity).where(AIActivity.metrics['success'].as_boolean().is_(True),
        AIActivity.metrics['provider_status'].as_integer() == 200).order_by(AIActivity.created_at.desc()).limit(1))
    failed = db.scalar(select(AIActivity).where(or_(AIActivity.metrics['last_error_code'].as_string().is_not(None),
        AIActivity.metrics['error_code'].as_string().is_not(None))).order_by(AIActivity.created_at.desc()).limit(1))
    settings = get_settings()
    result['health'] = {'provider': provider_name(settings), 'configured': provider_status()['configured'],
        'question_model': 'configured' if is_configured_value(model_for('question')) else 'missing',
        'support_model': 'configured' if is_configured_value(model_for('support')) else 'missing',
        'last_success_at': successful.created_at if successful else None,
        'last_error_at': failed.created_at if failed else None,
        'last_error_code': (failed.metrics.get('last_error_code') or failed.metrics.get('error_code')) if failed else None,
        'provider_tier': 'configured externally', 'cost': None}
    return ok(result)


@router.get('/admin/ai-support/export/{feature}')
def export(feature: Literal['question', 'support'], start: date | None = None, end: date | None = None,
           db: Session = Depends(get_db), user=Depends(admin)):
    begin, finish = bounds(start, end); rows, reviews, sessions, turns = dataset(db, begin, finish)
    output = StringIO(); writer = csv.writer(output)
    if feature == 'question':
        writer.writerow(['timestamp', 'document_type', 'requested', 'generated', 'accepted', 'edited', 'rejected', 'latency_ms', 'provider_status'])
        for row in rows:
            if row.feature != 'question': continue
            counts = [sum(r.activity_id == row.id and r.decision == v for r in reviews) for v in ('accepted', 'edited', 'rejected')]
            m = row.metrics
            writer.writerow([row.created_at.isoformat(), m.get('document_type'), m.get('requested_questions'), m.get('generated_questions'), *counts, m.get('latency_ms'), m.get('error_code') or m.get('provider_status')])
    else:
        writer.writerow(['timestamp', 'role', 'category', 'retrieval_hit', 'resolved_by_ai', 'escalated', 'provider_status'])
        for session in sessions:
            events = [r.metrics for r in rows if r.session_id == session.id]
            retrieved = [m for m in events if 'retrieval_count' in m]
            last = events[-1] if events else {}
            writer.writerow([session.created_at.isoformat(), session.role, session.category,
                any(m['retrieval_count'] > 0 for m in retrieved) if retrieved else '',
                any(t.session_id == session.id and t.action == 'resolved' for t in turns), session.escalated_at is not None,
                last.get('error_code') or last.get('provider_status')])
    return Response('\ufeff' + output.getvalue(), media_type='text/csv', headers={'Cache-Control': 'no-store',
        'Content-Disposition': f'attachment; filename="ai-{feature}-evaluation.csv"'})
