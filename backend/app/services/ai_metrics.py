"""Numeric/ID-only observations; no document, conversation or provider payloads."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from time import perf_counter
from uuid import UUID, uuid4
from app.models.entities import AIActivity, AIDraftReview
from app.services.audit import record_audit

_capture = ContextVar('ai_measurement', default=None)


def observe(event, fields):
    value = _capture.get()
    if value is None:
        return
    if event == 'provider_request':
        value['provider_attempts'] += 1
        value['retry_count'] += int(fields.get('attempt', 1) > 1)
    if event == 'provider_response':
        value['provider_status'] = fields.get('http_status')
        if fields.get('http_status', 0) >= 400:
            value['provider_failure_count'] += 1
    if event == 'provider_error':
        value['last_error_code'] = fields.get('error_code')
        if fields.get('response_received') is False:
            value['provider_failure_count'] += 1
    if event in ('question_parse', 'support_parse'):
        value['structured_parse_success'] = bool(fields.get('parse_success'))
    if event == 'support_retrieval':
        value['retrieval_count'] = fields.get('support_retrieval_count', 0)
        value['retrieved_articles'] = fields.get('retrieved_articles', [])
    if event == 'support_selection':
        value['selected_article_ids'] = fields.get('selected_article_ids', [])


@contextmanager
def measure():
    value = {'provider_attempts': 0, 'retry_count': 0, 'provider_failure_count': 0, 'provider_status': None}
    token = _capture.set(value); started = perf_counter()
    try:
        yield value
    finally:
        value['latency_ms'] = round((perf_counter() - started) * 1000, 2)
        _capture.reset(token)


def generation(db, user, session, sources, requirements, excluded, provider, replacement_id=None):
    from app.services.question_document_extract import DocumentError
    failure = None; drafts = []
    with measure() as metrics:
        try:
            drafts = provider.generate(sources=sources, requirements=requirements,
                config=session['config'], excluded=excluded)
        except DocumentError as exc:
            failure = exc
    if replacement_id and drafts:
        drafts[0]['id'] = str(replacement_id)
    from app.services.question_document_drafts import normalized_content
    source_map = {s['id']: s for s in sources}
    grounded = sum(d.get('source_chunk_id') in source_map and len(normalized_content(d.get('source_excerpt', ''))) >= 10
        and normalized_content(d['source_excerpt']) in normalized_content(source_map[d['source_chunk_id']].get('question_context') or source_map[d['source_chunk_id']]['text'])
        and {i['id'] for i in d.get('images', [])}.issubset({i['id'] for i in source_map[d['source_chunk_id']].get('images', [])}) for d in drafts)
    metrics.update(operation='regenerate' if replacement_id else 'generate',
        document_type=session['filename'].rsplit('.', 1)[-1].lower(), requested_questions=sum(requirements.values()),
        generated_questions=len(drafts), success=failure is None, error_code=failure.code if failure else None,
        questions_with_source=sum(bool(d.get('source_chunk_id') and d.get('source_excerpt')) for d in drafts),
        grounded_questions=grounded, image_questions=sum(bool(d.get('images')) for d in drafts),
        image_analysis_success=None)
    quality = getattr(drafts, 'quality_summary', None) or getattr(failure, 'quality_summary', None)
    if quality:
        metrics.update({f'quality_{key}': quality.get(key, 0) for key in
            ('generated', 'valid', 'needs_review', 'rejected', 'duplicate', 'unsupported', 'ambiguous')})
    # Grounding means server source-ID/excerpt/image validation, not semantic truth.
    row = AIActivity(id=uuid4(), feature='question', actor_id=user.id, role=user.role.value,
        document_id=UUID(str(session['id'])), metrics=metrics, created_at=datetime.now(timezone.utc))
    db.add(row); db.flush()
    for draft in drafts:
        db.add(AIDraftReview(id=uuid4(), activity_id=row.id, document_id=row.document_id, draft_id=UUID(draft['id'])))
    if failure is None:
        record_audit(db, action='AI_QUESTION_GENERATION_COMPLETED', user_id=user.id,
            entity_type='ai_activity', entity_id=row.id, metadata={'generated': len(drafts)})
    db.commit()
    if failure:
        raise failure
    return drafts
