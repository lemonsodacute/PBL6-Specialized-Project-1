"""Bounded read-only academic reports behind the existing support tool boundary."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, case, cast, func, Numeric, or_, select, union_all

from app.models.entities import (AttemptStatus, Class, ClassEnrollment, Exam, ExamAssignment, ExamAttempt,
    ExamQuestion, ExamStatus, Question, User, UserRole)
from app.services import support_academic as academic
from app.services.collections import search
from app.services.reports import _exam_for_user, roster_query, TERMINAL
from app.services.question_types import SUPPORTED_QUESTION_TYPES

MAX_EXAMS = 50
LOCAL_ZONE = timezone(timedelta(hours=7))


def backend_now():
    return datetime.now(timezone.utc)


def date_window(period, now):
    if not period:
        return None
    local = now.astimezone(LOCAL_ZONE)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == 'week':
        start -= timedelta(days=start.weekday()); end = start + timedelta(days=7)
    elif period == 'month':
        start = start.replace(day=1); end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    else:
        end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def authorized_classes(user):
    academic._actor(user)
    statement = select(Class)
    if user.role == UserRole.teacher:
        return statement.where(Class.homeroom_teacher_id == user.id)
    return statement.where(Class.id.in_(select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == user.id)))


def authorized_exams(user):
    academic._actor(user)
    statement = select(Exam).where(Exam.deleted_at.is_(None))
    if user.role == UserRole.teacher:
        return statement.where(Exam.created_by == user.id)
    return statement.where(Exam.status != ExamStatus.draft, Exam.id.in_(select(ExamAssignment.exam_id).where(or_(
        ExamAssignment.student_id == user.id, ExamAssignment.class_id.in_(
            select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == user.id))))))


def _teacher(user):
    academic._actor(user)
    if user.role != UserRole.teacher:
        raise HTTPException(403, 'This report is restricted to the managing teacher')


def _scope(ids=(), class_id=None, student_id=None):
    return {'exams': [str(key) for key in ids], 'classes': [str(class_id)] if class_id else [],
        'students': [str(student_id)] if student_id else []}


def _choices(query, field, rows, *, scope=None, reason=None):
    exams = field == 'exam_id'
    choices = [{'id': str(row.id), 'label': f'{row.title} — {row.start_time:%d/%m/%Y}' if exams else row.name,
        'value': f"{'Kỳ thi' if exams else 'Lớp'} {row.id}"} for row in rows[:academic.MAX_CHOICES]]
    return {'academic_report': True, 'status': 'choose_scope' if choices else 'no_scope', 'field': field,
        'choices': choices, 'more': len(rows) > academic.MAX_CHOICES, 'lookup': query.model_dump(mode='json'),
        'scope': scope or {'exams': [str(r.id) for r in rows[:academic.MAX_CHOICES]] if exams else [],
            'classes': [] if exams else [str(r.id) for r in rows[:academic.MAX_CHOICES]], 'students': []}, 'reason': reason}


def resolve_scope(db, user, query, now):
    query = query.model_copy()
    resolved_class = None
    if query.class_id or query.class_query or query.class_ref or query.intent == 'CLASS_SCORE_SUMMARY':
        classes = authorized_classes(user)
        if query.class_id:
            classes = classes.where(Class.id == query.class_id)
        elif query.class_query:
            for word in academic.normalized(query.class_query).split():
                classes = search(classes, word, Class.name)
        candidates = db.scalars(classes.order_by(Class.name, Class.id).limit(academic.MAX_CHOICES + 1)).all()
        if len(candidates) != 1:
            return query, None, _choices(query, 'class_id', candidates)
        resolved_class = candidates[0]; query.class_id = resolved_class.id
    exams = authorized_exams(user)
    if query.class_id:
        exams = exams.where(Exam.id.in_(select(ExamAssignment.exam_id).where(ExamAssignment.class_id == query.class_id)))
    if query.student_id:
        exams = exams.where(Exam.id.in_(academic._student_exams(user, query.student_id).with_only_columns(Exam.id)))
    if query.exam_id:
        exams = exams.where(Exam.id == query.exam_id)
    elif query.exam_query:
        # Every token must match the exam title or one assigned class. This handles
        # "giữa kỳ Web" without guessing a class/exam split from generated text.
        for word in academic.normalized(query.exam_query).split():
            title_ids = search(select(Exam.id), word, Exam.title)
            class_ids = search(select(Class.id), word, Class.name)
            exams = exams.where(or_(Exam.id.in_(title_ids), Exam.id.in_(
                select(ExamAssignment.exam_id).where(ExamAssignment.class_id.in_(class_ids)))))
    window = date_window(query.date_range, now)
    if window and query.intent != 'STUDENT_PROCTOR_ALERT_SUMMARY':
        exams = exams.where(Exam.end_time >= window[0], Exam.start_time < window[1])
    single = query.intent in ('STUDENTS_NOT_ATTEMPTED', 'STUDENTS_BELOW_SCORE', 'EXAM_SUBMISSION_SUMMARY', 'EXAM_RESULT_SUMMARY')
    single = single or (query.intent == 'STUDENT_PROCTOR_ALERT_SUMMARY' and not query.student_id)
    if user.role == UserRole.student and query.intent == 'STUDENTS_NOT_ATTEMPTED':
        single = False
    if query.exam_query or query.exam_id or query.exam_ref:
        single = True
    if query.intent == 'OPEN_EXAMS_LOOKUP':
        return query, resolved_class, exams
    candidates = db.scalars(exams.order_by(Exam.title, Exam.id).limit((academic.MAX_CHOICES if single else MAX_EXAMS) + 1)).all()
    if single and len(candidates) != 1:
        return query, resolved_class, _choices(query, 'exam_id', candidates)
    if len(candidates) > MAX_EXAMS:
        return query, resolved_class, _choices(query, 'exam_id', candidates, reason='Phạm vi có nhiều kỳ thi. Vui lòng chọn một đề để thu hẹp dữ liệu.')
    if len(candidates) == 1:
        query.exam_id = candidates[0].id
    return query, resolved_class, candidates


def _enrolled_ids(exam_id, class_id=None):
    """Current assignments, excluding historical students no longer in the roster."""
    direct = select(ExamAssignment.student_id.label('student_id')).where(ExamAssignment.exam_id == exam_id, ExamAssignment.student_id.is_not(None))
    enrolled = select(ClassEnrollment.student_id).where(ClassEnrollment.class_id.in_(
        select(ExamAssignment.class_id).where(ExamAssignment.exam_id == exam_id)))
    if class_id:
        members = select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == class_id)
        direct = direct.where(ExamAssignment.student_id.in_(members))
        enrolled = enrolled.where(ClassEnrollment.class_id == class_id)
    return union_all(direct, enrolled)


def _roster(db, user, exam, class_id=None, graded=False, current_only=True):
    _teacher(user); _exam_for_user(exam.id, db, user)
    if class_id and not db.scalar(authorized_classes(user).where(Class.id == class_id)):
        raise HTTPException(403, 'Class not authorized')
    statement, latest, score = roster_query(exam.id, SimpleNamespace(q=''), None, 'graded' if graded else None)
    if current_only:
        statement = statement.where(User.id.in_(_enrolled_ids(exam.id, class_id)))
    elif class_id:
        statement = statement.where(User.id.in_(select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == class_id)))
    return statement.with_only_columns(
        User.id.label('student_id'), User.full_name.label('student_name'), User.student_code,
        latest.id.label('attempt_id'), func.coalesce(latest.status, AttemptStatus.not_started).label('status'),
        score.label('score'), latest.max_score, latest.started_at, latest.submitted_at,
        latest.attempt_number, latest.exam_id)


def _record(row, exam):
    return {'student_id': str(row['student_id']), 'student_name': row['student_name'], 'student_code': row['student_code'],
        'attempt_id': str(row['attempt_id']) if row['attempt_id'] else None, 'exam_id': str(exam.id), 'exam_name': exam.title,
        'status': row['status'].value, 'score': str(row['score']) if row['score'] is not None else None,
        'max_score': str(row['max_score']) if row['max_score'] is not None else None,
        'percentage': str((row['score'] / row['max_score'] * 100).quantize(Decimal('.01'))) if row['score'] is not None and row['max_score'] and row['max_score'] > 0 else None}


def _percentage(score, maximum):
    # SQL optimizers may reorder WHERE predicates; make division safe itself.
    return score / func.nullif(cast(maximum, Numeric), 0) * 100


def get_students_without_attempt(db, user, exam, query):
    statement = _roster(db, user, exam, query.class_id)
    # "Chưa làm" means no qualifying attempt at all, even if a later placeholder
    # exists; "chưa nộp" follows the latest attempt shown by the existing roster.
    rows = statement.subquery()
    if query.status_filter == 'not_submitted':
        selected = select(rows).where(rows.c.status.not_in(TERMINAL))
    else:
        attempted = select(ExamAttempt.student_id).where(ExamAttempt.exam_id == exam.id, ExamAttempt.status != AttemptStatus.not_started)
        selected = select(rows).where(rows.c.student_id.not_in(attempted))
    total = db.scalar(select(func.count()).select_from(selected.subquery())) or 0
    records = db.execute(selected.order_by(rows.c.student_name, rows.c.student_id).limit(academic.MAX_RESULTS)).mappings().all()
    return {'rows': [_record(row, exam) for row in records], 'total': total, 'more': total > len(records)}


def get_students_below_score(db, user, exam, query):
    rows = _roster(db, user, exam, query.class_id, graded=True, current_only=False).subquery()
    value = rows.c.score
    selected = select(rows)
    if query.threshold_unit == 'percent':
        selected = selected.where(rows.c.max_score > 0)
        value = _percentage(rows.c.score, rows.c.max_score)
    selected = selected.where(value < query.threshold if query.comparison == 'lt' else value > query.threshold)
    total = db.scalar(select(func.count()).select_from(selected.subquery())) or 0
    records = db.execute(selected.order_by(value, rows.c.student_name, rows.c.student_id).limit(academic.MAX_RESULTS)).mappings().all()
    return {'rows': [_record(row, exam) for row in records], 'total': total, 'more': total > len(records)}


def get_exam_submission_summary(db, user, exam, query):
    rows = _roster(db, user, exam, query.class_id).subquery()
    counts = {state.value: 0 for state in AttemptStatus}
    for state, count in db.execute(select(rows.c.status, func.count()).group_by(rows.c.status)):
        counts[state.value] = count
    total = sum(counts.values())
    started = db.scalar(select(func.count(func.distinct(ExamAttempt.student_id))).where(
        ExamAttempt.exam_id == exam.id, ExamAttempt.student_id.in_(select(rows.c.student_id)),
        ExamAttempt.status != AttemptStatus.not_started)) or 0
    return {'total_enrolled': total, 'started': started, 'not_attempted': total - started,
        'submitted': counts['submitted'], 'auto_submitted': counts['auto_submitted'], 'terminated': counts['terminated'],
        'in_progress': counts['in_progress'], 'not_submitted': counts['in_progress'] + counts['not_started']}


def get_open_exams(db, user, query, statement, now):
    academic._actor(user)
    # A passed statement cannot grant access: intersect it with this actor's scope.
    statement = authorized_exams(user).where(Exam.id.in_(statement.with_only_columns(Exam.id)),
        Exam.status.in_((ExamStatus.published, ExamStatus.ongoing)), Exam.start_time <= now, Exam.end_time > now)
    if user.role == UserRole.student:
        legacy = select(ExamQuestion.exam_id).join(Question, Question.id == ExamQuestion.question_id).where(Question.type.not_in(SUPPORTED_QUESTION_TYPES))
        own = select(ExamAttempt.id).where(ExamAttempt.exam_id == Exam.id, ExamAttempt.student_id == user.id).correlate(Exam)
        completed = own.where(ExamAttempt.status.in_(TERMINAL)).exists()
        count = select(func.count()).select_from(ExamAttempt).where(ExamAttempt.exam_id == Exam.id, ExamAttempt.student_id == user.id).correlate(Exam).scalar_subquery()
        working = own.where(ExamAttempt.status == AttemptStatus.in_progress, ExamAttempt.server_deadline_at > now).exists()
        statement = statement.where(Exam.id.not_in(legacy), or_(working, and_(~completed, count < Exam.max_attempts)))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    exams = db.scalars(statement.order_by(Exam.end_time, Exam.id).limit(academic.MAX_RESULTS)).all()
    return {'rows': [{'exam_id': str(e.id), 'exam_name': e.title, 'start_time': e.start_time.isoformat(),
        'end_time': e.end_time.isoformat(), 'status': e.status.value,
        'route': f'/dashboard/exams/{e.id}' if user.role == UserRole.teacher else '/student/exams'} for e in exams],
        'total': total, 'more': total > len(exams), 'as_of': now.isoformat()}


def get_self_unattempted_exams(db, user, exams, query):
    academic._actor(user)
    if user.role != UserRole.student:
        raise HTTPException(403, 'Student self lookup only')
    condition = ExamAttempt.status.in_(TERMINAL) if query.status_filter == 'not_submitted' else ExamAttempt.status != AttemptStatus.not_started
    done = select(ExamAttempt.exam_id).where(ExamAttempt.student_id == user.id, condition)
    statement = authorized_exams(user).where(Exam.id.in_([e.id for e in exams]), Exam.id.not_in(done))
    rows = db.scalars(statement.order_by(Exam.start_time, Exam.id).limit(academic.MAX_RESULTS)).all()
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    return {'rows': [{'exam_id': str(e.id), 'exam_name': e.title, 'status': e.status.value,
        'start_time': e.start_time.isoformat(), 'end_time': e.end_time.isoformat(), 'route': '/student/exams'} for e in rows],
        'total': total, 'more': total > len(rows), 'self_only': True}


def get_class_score_summary(db, user, exams, query):
    _teacher(user)
    if not exams:
        return {'graded_count': 0, 'graded_students': 0, 'attempt_count': 0, 'submitted_count': 0, 'average': None,
            'highest': None, 'lowest': None, 'median': None, 'scale': 'percent', 'distribution': [], 'pass_count': None, 'fail_count': None}
    parts = [_roster(db, user, e, query.class_id, graded=True, current_only=False) for e in exams]
    graded = union_all(*parts).subquery() if len(parts) > 1 else parts[0].subquery()
    counts = db.execute(select(func.count(), func.count(func.distinct(graded.c.student_id)),
        func.min(graded.c.max_score), func.max(graded.c.max_score), func.count(graded.c.max_score))).one()
    raw = len(exams) == 1 and counts[0] and counts[4] == counts[0] and counts[2] == counts[3] and counts[2] > 0
    value = graded.c.score if raw else _percentage(graded.c.score, graded.c.max_score)
    measured = select(value.label('value')).where(graded.c.max_score > 0).subquery()
    stats = db.execute(select(func.count(), func.avg(measured.c.value), func.min(measured.c.value), func.max(measured.c.value))).one()
    median = None
    if stats[0]:
        middle = db.scalars(select(measured.c.value).order_by(measured.c.value).offset((stats[0] - 1) // 2).limit(1 if stats[0] % 2 else 2)).all()
        median = sum(Decimal(str(v)) for v in middle) / len(middle)
    def number(value):
        return str(Decimal(str(value)).quantize(Decimal('.01'))) if value is not None else None
    attempt_query = select(ExamAttempt).where(ExamAttempt.exam_id.in_([e.id for e in exams]))
    if query.class_id:
        attempt_query = attempt_query.where(ExamAttempt.student_id.in_(select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == query.class_id)))
    # All actual attempts are counted; score statistics use the latest attempt per
    # student/exam, matching the existing report roster (never a best-score rule).
    attempt_scope = attempt_query.subquery()
    attempt_count, submitted_count = db.execute(select(func.count(), func.sum(case((attempt_scope.c.status.in_(TERMINAL), 1), else_=0)))).one()
    percent = _percentage(graded.c.score, graded.c.max_score)
    buckets = []
    for lower, upper in ((0, 50), (50, 70), (70, 85), (85, 100)):
        upper_bound = percent <= upper if upper == 100 else percent < upper
        count = db.scalar(select(func.count()).select_from(graded).where(graded.c.max_score > 0, percent >= lower, upper_bound)) or 0
        buckets.append({'label': f'{lower}–{upper}%' if upper == 100 else f'{lower}–<{upper}%', 'count': count})
    outside = db.scalar(select(func.count()).select_from(graded).where(graded.c.max_score > 0, or_(percent < 0, percent > 100))) or 0
    if outside:
        buckets.append({'label': 'Ngoài 0–100%', 'count': outside})
    pass_count = fail_count = None
    if len(exams) == 1 and exams[0].passing_score is not None:
        pass_count = db.scalar(select(func.count()).select_from(graded).where(graded.c.score >= exams[0].passing_score)) or 0
        fail_count = counts[0] - pass_count
    return {'graded_count': counts[0], 'graded_students': counts[1], 'average': number(stats[1]), 'lowest': number(stats[2]),
        'highest': number(stats[3]), 'median': number(median), 'scale': str(counts[2]) if raw else 'percent',
        'normalized_count': stats[0], 'attempt_count': attempt_count, 'submitted_count': submitted_count or 0,
        'distribution': buckets, 'pass_count': pass_count, 'fail_count': fail_count,
        'passing_score': str(exams[0].passing_score) if len(exams) == 1 and exams[0].passing_score is not None else None}


def get_exam_result_summary(db, user, exam, query):
    return get_class_score_summary(db, user, [exam], query)


def execute_query(db, user, query):
    academic._actor(user)
    teacher_only = query.intent in ('STUDENTS_BELOW_SCORE', 'EXAM_SUBMISSION_SUMMARY', 'CLASS_SCORE_SUMMARY', 'EXAM_RESULT_SUMMARY', 'STUDENT_PROCTOR_ALERT_SUMMARY')
    if teacher_only and user.role != UserRole.teacher:
        academic._audit(db, user, query, 'academic_report', 'denied')
        return {'academic_report': True, 'status': 'denied'}
    if user.role == UserRole.student and (query.student_id or query.student_name or query.student_code):
        found = academic.search_authorized_students(db, user, query)
        if found['status'] != 'found':
            return found
    student = None
    if query.intent == 'STUDENT_PROCTOR_ALERT_SUMMARY' and (query.student_id or query.student_name or query.student_code or query.student_ref):
        found = academic.search_authorized_students(db, user, query)
        if found['status'] != 'found':
            return found
        student = found['students'][0]; query = query.model_copy(update={'student_id': UUID(student['id'])})
    now = backend_now()
    query, cls, exams = resolve_scope(db, user, query, now)
    if isinstance(exams, dict):
        academic._audit(db, user, query, 'resolve_academic_scope', exams['status'], query.student_id)
        return exams
    if query.intent == 'OPEN_EXAMS_LOOKUP':
        data = get_open_exams(db, user, query, exams, now)
        scope = _scope([UUID(r['exam_id']) for r in data['rows']], query.class_id)
    else:
        scope = _scope([e.id for e in exams], query.class_id, query.student_id)
        if query.intent == 'STUDENTS_NOT_ATTEMPTED':
            data = get_self_unattempted_exams(db, user, exams, query) if user.role == UserRole.student else get_students_without_attempt(db, user, exams[0], query)
        elif query.intent == 'STUDENTS_BELOW_SCORE':
            if query.threshold is None:
                return {'status': 'scope_error', 'message': 'Bạn muốn lọc theo ngưỡng điểm nào?'}
            data = get_students_below_score(db, user, exams[0], query)
        elif query.intent == 'EXAM_SUBMISSION_SUMMARY':
            data = get_exam_submission_summary(db, user, exams[0], query)
        elif query.intent == 'EXAM_RESULT_SUMMARY':
            data = get_exam_result_summary(db, user, exams[0], query)
            if query.threshold is not None:
                data['threshold_result'] = get_students_below_score(db, user, exams[0], query)
        elif query.intent == 'CLASS_SCORE_SUMMARY':
            data = get_class_score_summary(db, user, exams, query)
        else:
            from app.services.monitoring_reports import student_alert_summary
            data = student_alert_summary(db, user, [e.id for e in exams], student_id=query.student_id,
                class_id=query.class_id, severity=query.severity, review_status=query.review_status,
                window=date_window(query.date_range, now), ranked=query.ranked, include_types=query.distribution, limit=academic.MAX_RESULTS)
    visible_students = [row['student_id'] for row in data.get('students', data.get('rows', [])) if row.get('student_id')]
    scope['students'] = list(dict.fromkeys(scope['students'] + visible_students))
    academic._audit(db, user, query, query.intent.lower(), 'found', query.student_id)
    return {'academic_report': True, 'status': 'report', 'intent': query.intent, 'data': data, 'student': student, 'role': user.role.value,
        'scope': scope, 'context': {'student_id': str(query.student_id) if query.student_id else None,
            'class_id': str(query.class_id) if query.class_id else None, 'exam_id': str(query.exam_id) if query.exam_id else None},
        'class_name': cls.name if cls else None, 'exam_name': exams[0].title if isinstance(exams, list) and len(exams) == 1 else None,
        'exam_id': str(exams[0].id) if isinstance(exams, list) and len(exams) == 1 else None, 'as_of': now.isoformat()}


def format_report(result, query, source):
    status = result['status']; source['scope'] = result.get('scope', _scope())
    if status == 'denied':
        return 'Bạn không có quyền xem báo cáo này. Báo cáo lớp và giám sát chỉ dành cho giảng viên quản lý; sinh viên chỉ được tra cứu dữ liệu của chính mình.', [source], None
    if status == 'scope_error':
        return result['message'], [source], None
    if status in ('choose_scope', 'no_scope'):
        kind = 'đề thi' if result['field'] == 'exam_id' else 'lớp'
        if status == 'no_scope':
            return f'Không tìm thấy {kind} phù hợp trong phạm vi bạn được phép xem.', [source], None
        source['choices'] = [{k: c[k] for k in ('label', 'value')} for c in result['choices']]
        text = result.get('reason') or f'Bạn muốn kiểm tra {kind} nào?'
        text += '\n' + '\n'.join(f"{i + 1}. {c['label']}" for i, c in enumerate(result['choices']))
        if result['more']:
            text += '\nCòn lựa chọn khác; hãy nhập tên cụ thể hơn.'
        return text, [source], {k: result[k] for k in ('lookup', 'field', 'choices')}
    data = result['data']
    title = (result.get('class_name') if query.intent == 'CLASS_SCORE_SUMMARY' else result.get('exam_name')) or result.get('class_name') or 'Dữ liệu học tập'
    lines = [title]
    intent = query.intent
    if intent == 'OPEN_EXAMS_LOOKUP' or data.get('self_only'):
        label = 'đang mở' if intent == 'OPEN_EXAMS_LOOKUP' else 'bạn chưa nộp' if query.status_filter == 'not_submitted' else 'bạn chưa làm'
        lines = [f"Có {data['total']} bài kiểm tra {label}." if data['total'] else f'Không có bài kiểm tra nào {label}.']
        for row in data['rows']:
            lines.append(f"• {row['exam_name']} · {row['start_time']} → {row['end_time']}")
        source.update(title='Xem danh sách bài thi', route='/student/exams' if result['role'] == 'student' else '/dashboard/exams')
    elif intent in ('STUDENTS_NOT_ATTEMPTED', 'STUDENTS_BELOW_SCORE'):
        if intent == 'STUDENTS_NOT_ATTEMPTED':
            condition = 'chưa nộp bài' if query.status_filter == 'not_submitted' else 'chưa làm bài'
        else:
            condition = f"{'dưới' if query.comparison == 'lt' else 'trên'} {query.threshold}{'%' if query.threshold_unit == 'percent' else ' điểm'}"
        lines.append(f"Có {data['total']} sinh viên {condition}." if data['total'] else f'Không có sinh viên nào {condition} trong đề này.')
        for row in data['rows']:
            line = f"• {row['student_name']}" + (f" — MSSV {row['student_code']}" if row['student_code'] else '')
            if row['score'] is not None:
                line += (f" · {row['score']}/{row['max_score']}" if row['max_score'] is not None else f" · {row['score']} điểm (chưa có thang điểm)")
                line += f" — {row['percentage']}%" if row['percentage'] else ''
            lines.append(line)
    elif intent == 'EXAM_SUBMISSION_SUMMARY':
        lines.extend([f"• Tổng sinh viên được giao: {data['total_enrolled']}", f"• Đã bắt đầu: {data['started']}",
            f"• Đã nộp: {data['submitted']}", f"• Tự động nộp: {data['auto_submitted']}", f"• Đã kết thúc: {data['terminated']}",
            f"• Đang làm: {data['in_progress']}", f"• Chưa làm: {data['not_attempted']}", f"• Chưa nộp: {data['not_submitted']}"])
    elif intent in ('CLASS_SCORE_SUMMARY', 'EXAM_RESULT_SUMMARY'):
        lines.extend([f"• Lượt làm bài: {data['attempt_count']} · Đã nộp/kết thúc: {data['submitted_count']}",
            f"• Sinh viên có điểm hoàn tất: {data['graded_students']} · Kết quả hoàn tất: {data['graded_count']}"])
        if data['average'] is None:
            lines.append('Chưa có điểm hoàn tất với thang điểm hợp lệ để thống kê.')
        else:
            unit = '%' if data['scale'] == 'percent' else '/' + data['scale']
            lines.extend([f"• Trung bình: {data['average']}{unit} · Trung vị: {data['median']}{unit}",
                f"• Cao nhất: {data['highest']}{unit} · Thấp nhất: {data['lowest']}{unit}"])
            if data['scale'] == 'percent':
                lines.append('Điểm được chuẩn hóa theo phần trăm để so sánh các thang điểm khác nhau.')
            lines.append('Dùng lượt làm bài mới nhất của mỗi sinh viên trong từng đề; không chọn điểm cao nhất.')
        if data['pass_count'] is not None:
            lines.append(f"• Đạt: {data['pass_count']} · Chưa đạt: {data['fail_count']} (ngưỡng đã lưu: {data['passing_score']} điểm)")
        if 'threshold_result' in data:
            lines.append(f"• Trên {query.threshold}{'%' if query.threshold_unit == 'percent' else ' điểm'}: {data['threshold_result']['total']} sinh viên")
        if query.distribution and data['distribution']:
            lines.append('Phân bố: ' + '; '.join(f"{b['label']}: {b['count']}" for b in data['distribution']))
    else:
        names = {'info': 'Thông tin', 'low': 'Thấp', 'medium': 'Trung bình', 'high': 'Cao', 'critical': 'Rất cao'}
        lines = [f"Có {data['total_students']} sinh viên phù hợp với bộ lọc cảnh báo."]
        if result.get('student'):
            lines.insert(0, result['student']['name'])
        source['links'] = []
        for row in data['students']:
            lines.append(f"• {row['student_name']}" + (f" — MSSV {row['student_code']}" if row['student_code'] else '') +
                f": {row['total']} cảnh báo giám sát · Cao nhất: {names.get(row['highest_severity'], 'Không có')}" +
                f" · Mới: {row['new']} · Đã xem: {row['reviewed']} · Xác nhận: {row['confirmed']} · Bỏ qua: {row['dismissed']}")
            for attempt in row['attempts']:
                label = f"{attempt['exam_name']} — lần {attempt['attempt_number']}"
                lines.append(f"  {label}: {attempt['total']} cảnh báo")
                if len(source['links']) < 6:
                    source['links'].append({'label': f"Giám sát {row['student_name']} · {label}",
                        'route': f"/dashboard/monitor/{attempt['exam_id']}/{attempt['attempt_id']}"})
            if row['attempt_count'] > len(row['attempts']):
                lines.append('  Hiển thị 3 lượt gần nhất có cảnh báo; mở báo cáo để xem đầy đủ.')
            if row.get('types'):
                lines.append('  Loại sự kiện: ' + '; '.join(f"{item['type']}: {item['count']}" for item in row['types']))
        if not data['students']:
            lines.append('Không có sự kiện giám sát phù hợp trong phạm vi được phép xem.')
        lines.append('Cảnh báo là sự kiện cần xem xét; giảng viên là người đánh giá cuối cùng.')
        if result.get('exam_id'):
            source.update(title='Xem báo cáo giám sát', route=f"/dashboard/monitor/{result['exam_id']}")
        elif data['students'] and data['students'][0].get('exam_ids') and len(data['students'][0]['exam_ids']) == 1:
            source.update(title='Xem báo cáo giám sát', route=f"/dashboard/monitor/{data['students'][0]['exam_ids'][0]}")
    if data.get('more'):
        lines.append(f'Hiển thị tối đa {academic.MAX_RESULTS} mục. Mở trang chi tiết để xem đầy đủ.')
    if not source['route'] and result.get('exam_id') and intent != 'STUDENT_PROCTOR_ALERT_SUMMARY':
        source.update(title='Xem kết quả', route=f"/dashboard/exams/{result['exam_id']}/report")
    elif not source['route'] and result.get('class_name'):
        source.update(title='Xem lớp học', route=f"/dashboard/classes/{result['context']['class_id']}")
    return '\n'.join(lines), [source], None
