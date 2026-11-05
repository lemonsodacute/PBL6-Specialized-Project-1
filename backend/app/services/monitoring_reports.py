"""Exam-scoped, paginated attempt summaries over persisted proctor events."""
from sqlalchemy import case, func, or_, select
from app.models.entities import Class, ClassEnrollment, DetectionEvent, Exam, ExamAssignment, ExamAttempt, User, UserRole


SEVERITIES = ('info', 'low', 'medium', 'high', 'critical')


def _event_aggregates():
    """One severity/review-state projection for monitor and support reports."""
    rank = case(*[(DetectionEvent.severity == value, index + 1) for index, value in enumerate(SEVERITIES)], else_=0)
    counts = {status.lower(): func.sum(case((DetectionEvent.status == status, 1), else_=0))
        for status in ('NEW', 'REVIEWED', 'CONFIRMED', 'DISMISSED')}
    return rank, counts


def student_alert_summary(db, user, exam_ids, *, student_id=None, class_id=None, severity=None,
        review_status=None, window=None, ranked=False, include_types=False, limit=20):
    """Read-only support projection of the existing persisted monitoring events.

    Uses the same real/simulated channel, severity order and review-state meanings
    as attempt_report. No alert ingestion, deduplication or review mutation occurs.
    """
    from fastapi import HTTPException
    from app.services.reports import _exam_for_user
    if user.role != UserRole.teacher or not user.is_active:
        raise HTTPException(403, 'Teacher monitoring access required')
    if len(exam_ids) > 50:
        raise HTTPException(422, 'Narrow the exam scope')
    for exam_id in exam_ids:
        _exam_for_user(exam_id, db, user)
    if class_id and not db.scalar(select(Class.id).where(Class.id == class_id, Class.homeroom_teacher_id == user.id)):
        raise HTTPException(403, 'Class not authorized')
    # Aggregate before applying review/severity filters so returned totals remain
    # all persisted alerts for each selected student, as in the monitoring UI.
    scope = [DetectionEvent.exam_id.in_(exam_ids), DetectionEvent.is_simulated.is_(False)]
    if student_id:
        scope.append(DetectionEvent.student_id == student_id)
    if class_id:
        scope.append(DetectionEvent.student_id.in_(select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == class_id)))
    if window:
        scope.extend([DetectionEvent.occurred_at >= window[0], DetectionEvent.occurred_at < window[1]])
    rank, counts = _event_aggregates()
    query = select(User.id.label('student_id'), User.full_name.label('student_name'), User.student_code,
        func.count().label('total'), func.count(func.distinct(DetectionEvent.attempt_id)).label('attempt_count'),
        func.max(rank).label('rank'), *[value.label(key) for key, value in counts.items()])
    query = query.join(DetectionEvent, DetectionEvent.student_id == User.id).where(*scope).group_by(User.id, User.full_name, User.student_code)
    if severity:
        # "High" includes critical events, consistent with high-priority alerts.
        query = query.having(func.max(rank) >= SEVERITIES.index(severity) + 1)
    if review_status == 'unresolved':
        query = query.having(counts['new'] + counts['reviewed'] > 0)
    elif review_status in counts:
        query = query.having(counts[review_status] > 0)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    if ranked:
        maximum = db.scalar(select(func.max(query.subquery().c.total)))
        query = query.having(func.count() == maximum)  # Include ties; do not guess one student.
        total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(func.count().desc(), User.full_name, User.id).limit(max(1, min(limit, 20)))).mappings().all()
    selected = [r['student_id'] for r in rows]
    attempts = {}
    recent = select(DetectionEvent.student_id.label('sid'), DetectionEvent.attempt_id.label('aid'),
        DetectionEvent.exam_id.label('eid'), func.count().label('total'),
        func.row_number().over(partition_by=DetectionEvent.student_id,
            order_by=(func.max(DetectionEvent.occurred_at).desc(), DetectionEvent.attempt_id)).label('position'))\
        .where(*scope, DetectionEvent.student_id.in_(selected))\
        .group_by(DetectionEvent.student_id, DetectionEvent.attempt_id, DetectionEvent.exam_id).subquery()
    for row in db.execute(select(recent, ExamAttempt.attempt_number, Exam.title).join(ExamAttempt, ExamAttempt.id == recent.c.aid)
            .join(Exam, Exam.id == recent.c.eid).where(recent.c.position <= 3).order_by(recent.c.sid, recent.c.position)).mappings():
        attempts.setdefault(row['sid'], []).append({'attempt_id': str(row['aid']), 'exam_id': str(row['eid']),
            'exam_name': row['title'], 'attempt_number': row['attempt_number'], 'total': row['total']})
    types = {}
    if include_types:
        for sid, kind, count in db.execute(select(DetectionEvent.student_id, DetectionEvent.event_type, func.count())
                .where(*scope, DetectionEvent.student_id.in_(selected)).group_by(DetectionEvent.student_id, DetectionEvent.event_type)):
            types.setdefault(sid, []).append({'type': kind.value if hasattr(kind, 'value') else kind, 'count': count})
    return {'total_students': total, 'more': total > len(rows), 'students': [
        {'student_id': str(r['student_id']), 'student_name': r['student_name'], 'student_code': r['student_code'],
         'total': r['total'], 'highest_severity': SEVERITIES[r['rank'] - 1] if r['rank'] else None,
         **{key: r[key] for key in counts}, 'attempt_count': r['attempt_count'], 'attempts': attempts.get(r['student_id'], []),
         'exam_ids': list(dict.fromkeys(a['exam_id'] for a in attempts.get(r['student_id'], []))),
         'types': types.get(r['student_id'], [])} for r in rows]}


def attempt_report(db, exam, simulated=False, *, page=1, limit=30, q='', alert_filter='all', severity=None):
    scope = (DetectionEvent.exam_id == exam.id, DetectionEvent.is_simulated == simulated)
    rank, review_counts = _event_aggregates()
    grouped = select(DetectionEvent.attempt_id.label('attempt_id'), func.count().label('total'),
        func.max(rank).label('rank'), *[value.label(key) for key, value in review_counts.items()]
        ).where(*scope).group_by(DetectionEvent.attempt_id).subquery()
    total = func.coalesce(grouped.c.total, 0)
    highest = func.coalesce(grouped.c.rank, 0)
    counts = [func.coalesce(getattr(grouped.c, status), 0) for status in ('new', 'reviewed', 'confirmed', 'dismissed')]
    query = select(ExamAttempt, User, total, highest, *counts).join(User, User.id == ExamAttempt.student_id).outerjoin(
        grouped, grouped.c.attempt_id == ExamAttempt.id).where(ExamAttempt.exam_id == exam.id)
    if q:
        term = '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.where(or_(User.full_name.ilike(term, escape='\\'), User.student_code.ilike(term, escape='\\')))
    if alert_filter == 'with_alerts': query = query.where(total > 0)
    elif alert_filter == 'unresolved': query = query.where(counts[0] + counts[1] > 0)
    elif alert_filter in ('new', 'confirmed', 'dismissed'): query = query.where(func.coalesce(getattr(grouped.c, alert_filter), 0) > 0)
    if severity: query = query.where(highest == SEVERITIES.index(severity) + 1)
    matched = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(case((highest >= 4, 1), else_=0).desc(), counts[0].desc(),
        total.desc(), highest.desc(), User.full_name, ExamAttempt.attempt_number, ExamAttempt.id).offset((page - 1) * limit).limit(limit)).all()
    attempts = []
    for attempt, student, count, priority, new, reviewed, confirmed, dismissed in rows:
        attempts.append({'id': attempt.id, 'student': {'id': student.id, 'full_name': student.full_name, 'student_code': student.student_code},
            'attempt_number': attempt.attempt_number, 'status': attempt.status, 'started_at': attempt.started_at,
            'submitted_at': attempt.submitted_at, 'total': count, 'highest_severity': SEVERITIES[priority - 1] if priority else None,
            'new': new, 'reviewed': reviewed, 'confirmed': confirmed, 'dismissed': dismissed})
    classes = db.execute(select(Class.id, Class.name).join(ExamAssignment, ExamAssignment.class_id == Class.id)
        .where(ExamAssignment.exam_id == exam.id).distinct().order_by(Class.name, Class.id)).all()
    teacher = db.get(User, exam.created_by)
    return {'exam': {'id': exam.id, 'title': exam.title, 'status': exam.status, 'start_time': exam.start_time,
            'end_time': exam.end_time, 'duration_minutes': exam.duration_minutes, 'teacher_name': teacher.full_name if teacher else None,
            'classes': [{'id': key, 'name': name} for key, name in classes]},
        'attempts': attempts, 'pagination': {'total': matched, 'page': page, 'limit': limit},
        'participating_students': db.scalar(select(func.count(func.distinct(ExamAttempt.student_id))).where(ExamAttempt.exam_id == exam.id)) or 0,
        'total_attempts': db.scalar(select(func.count()).select_from(ExamAttempt).where(ExamAttempt.exam_id == exam.id)) or 0,
        'students_with_alerts': db.scalar(select(func.count(func.distinct(DetectionEvent.student_id))).where(*scope)) or 0}
