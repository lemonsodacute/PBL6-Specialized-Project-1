"""Read-only, actor-scoped academic tools for AI Support.

No generated SQL, score calculation, expiry finalization, KB writes or model calls.
The assistant renders a bounded structured result deterministically so every score
claim is a persisted value, even when the external AI provider is unavailable.
"""
import re
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import load_only

from app.models.entities import Class, ClassEnrollment, Exam, ExamAssignment, ExamAttempt, ExamStatus, User, UserRole
from app.services.audit import record_audit
from app.services.collections import search, fold_text
from app.services.reports import saved_attempt, TERMINAL
from app.services.student_exam_state import student_result_metadata_many

MAX_CHOICES = 8
MAX_RESULTS = 20


class Lookup(BaseModel):
    model_config = ConfigDict(extra='forbid')
    intent: Literal['STUDENT_SCORE_LOOKUP', 'STUDENT_ATTEMPT_HISTORY', 'STUDENTS_NOT_ATTEMPTED',
        'STUDENTS_BELOW_SCORE', 'EXAM_SUBMISSION_SUMMARY', 'OPEN_EXAMS_LOOKUP',
        'STUDENT_PROCTOR_ALERT_SUMMARY', 'CLASS_SCORE_SUMMARY', 'EXAM_RESULT_SUMMARY'] = 'STUDENT_SCORE_LOOKUP'
    student_name: str = ''
    student_code: str = ''
    student_id: UUID | None = None
    self_requested: bool = False
    exam_query: str = ''
    class_query: str = ''
    exam_id: UUID | None = None
    class_id: UUID | None = None
    threshold: Decimal | None = Field(default=None, ge=0, le=1000000)
    threshold_unit: Literal['points', 'percent'] = 'points'
    comparison: Literal['lt', 'gt'] = 'lt'
    status_filter: Literal['not_attempted', 'not_submitted', 'submitted', 'in_progress'] | None = None
    severity: Literal['info', 'low', 'medium', 'high', 'critical'] | None = None
    review_status: Literal['unresolved', 'new', 'reviewed', 'confirmed', 'dismissed'] | None = None
    date_range: Literal['today', 'week', 'month'] | None = None
    ranked: bool = False
    distribution: bool = False
    student_ref: bool = False
    class_ref: bool = False
    exam_ref: bool = False
    scope_error: str = ''


def normalized(text):
    return re.sub(r'\s+', ' ', fold_text(text)).strip(' ?!.,;:')


def detect_lookup(text: str) -> Lookup | None:
    """Accent/case-independent sentence patterns, not exact sample matching.

    Ambiguous data requests ask for an entity instead of falling through to RAG.
    Model output is never used as an authorization decision or database command.
    """
    text = normalized(text)
    if re.search(r'\b(lam sao|nhu the nao|o dau|huong dan|cach (?:xem|tinh|tra)|diem duoc tinh|sua diem|diem sai|sai diem)\b', text):
        return None
    from app.services.support_academic_intents import extract_intent
    expanded = extract_intent(text)
    if expanded:
        return Lookup(**expanded)
    if not re.search(r'\b(diem|ket qua|lich su lam bai|duoc bao nhieu)\b', text):
        return None
    query = Lookup(intent='STUDENT_ATTEMPT_HISTORY' if 'lich su lam bai' in text else 'STUDENT_SCORE_LOOKUP')
    text = re.sub(r'^(?:(?:vui long )?cho (?:toi|minh) (?:xem|biet)|vui long|tra cuu|xem)\s+', '', text)
    text = re.sub(r'\s+(?:nhe|a|voi|giup toi|giup minh|duoc khong)$', '', text)
    cls = re.search(r'\s+(?:(?:trong|o|thuoc)\s+)?lop\s+(.+)$', text)
    if cls:
        query.class_query = cls[1]; text = text[:cls.start()]
    code = re.search(r'\b(?:mssv|ma sinh vien)\s*[:=]?\s*([a-z0-9_-]+)\b', text)
    if code:
        query.student_code = code[1].upper()
        # Keep optional exam context before "của MSSV ...".
        text = text[:code.start()] + 'toi'
    possessive = re.search(r'\b(?:diem|ket qua(?: thi)?|lich su lam bai)\s*(.*?)\s+cua\s+(.+)$', text)
    subject = re.search(r'^(.*?)\s+(?:duoc|dat)\s+bao nhieu\s+diem\s*(.*)$', text)
    taking = re.search(r'^(.*?)\s+lam bai\s+(.+?)\s+(?:duoc|dat)\s+bao nhieu(?: diem)?$', text)
    if possessive:
        query.exam_query = possessive[1]; query.student_name = possessive[2]
    elif subject:
        query.student_name = subject[1]; query.exam_query = subject[2]
    elif taking:
        query.student_name = taking[1]; query.exam_query = taking[2]
    else:
        direct = re.search(r'\b(?:diem|ket qua(?: thi)?|lich su lam bai)\s+(?:sinh vien\s+)?(.+)$', text)
        if direct:
            query.student_name = direct[1]
    query.student_name = re.sub(r'^(?:sinh vien|ban|em)\s+', '', query.student_name).strip()
    trailing = re.search(r'\s+(?:trong\s+)?(?:mon|bai thi|ky thi)\s+(.+)$', query.student_name)
    if trailing:
        query.exam_query = trailing[1]; query.student_name = query.student_name[:trailing.start()]
    query.exam_query = re.sub(r'^(?:mon|bai thi|ky thi)\s+', '', query.exam_query).strip()
    if query.student_name in ('toi', 'minh', 'em', 'ban than', 'cua toi'):
        query.self_requested = not bool(query.student_code); query.student_name = ''
    if query.student_code:
        query.student_name = ''
    return query


def resolve_followup(text, pending) -> Lookup | None:
    if not pending:
        return None
    text = normalized(text)
    lookup = Lookup.model_validate(pending['lookup'])
    choices = pending.get('choices', [])
    selected = next((c for c in choices if normalized(c['value']) == text), None)
    if re.fullmatch(r'(?:so |chon )?\d+', text):
        index = int(text.split()[-1]) - 1
        selected = choices[index] if 0 <= index < len(choices) else None
        if not selected:
            return lookup  # Re-query authorized choices; never route an invalid selection to RAG.
    if selected:
        field = pending['field']
        setattr(lookup, field, UUID(selected['id']))
        if field == 'student_id':
            lookup.student_name = ''; lookup.student_code = ''; lookup.self_requested = False
        return lookup
    if pending['field'] in ('exam_id', 'class_id') and not re.search(
            r'\b(lam sao|huong dan|cach|o dau|nhu the nao|camera|mat khau|loi|xin chao)\b', text):
        if re.fullmatch(r'[a-z0-9 _-]{1,160}', text):
            field = pending['field']
            setattr(lookup, field, None)
            setattr(lookup, 'exam_query' if field == 'exam_id' else 'class_query', text)
            return lookup
    code = re.fullmatch(r'(?:mssv|ma sinh vien)\s*[:=]?\s*([a-z0-9_-]+)', text)
    if code or (pending['field'] == 'student_id' and re.fullmatch(r'[a-z0-9_-]*\d[a-z0-9_-]*', text)):
        lookup.student_id = None; lookup.student_name = ''; lookup.self_requested = False
        lookup.student_code = (code[1] if code else text).upper()
        return lookup
    name = re.sub(r'^(?:sinh vien|ban)\s+', '', text)
    if pending['field'] == 'student_id' and re.fullmatch(r'[a-z]+(?: [a-z]+){0,5}', name) and not re.search(
            r'\b(lam sao|o dau|huong dan|camera|micro|alo|chao|diem|ket qua|loi|tai khoan|mat khau|giam sat)\b', name):
        lookup.student_id = None; lookup.student_code = ''; lookup.self_requested = False
        lookup.student_name = name
        return lookup
    return None


def resolve_context(query: Lookup, context):
    """Only identifiers from this chat; every subsequent tool reauthorizes them."""
    if not context:
        return query
    query = query.model_copy()
    has_student = query.student_id or query.student_name or query.student_code or query.self_requested
    if not has_student and (query.student_ref or query.intent == 'STUDENT_ATTEMPT_HISTORY') and context.get('student_id'):
        query.student_id = UUID(context['student_id'])
    personal = query.intent in ('STUDENT_SCORE_LOOKUP', 'STUDENT_ATTEMPT_HISTORY') or bool(query.student_name or query.student_code)
    explicit_exam = query.exam_id or query.exam_query
    if not (query.class_id or query.class_query) and (query.class_ref or (not personal and not explicit_exam)) and context.get('class_id'):
        query.class_id = UUID(context['class_id'])
    if not explicit_exam and (query.exam_ref or (not personal and not query.class_query and not query.class_ref)) and context.get('exam_id'):
        query.exam_id = UUID(context['exam_id'])
    return query


def result_context(result, query):
    if result.get('context') is not None:
        return result['context']
    if result.get('status') == 'results':
        ids = set(row['exam_id'] for row in result['results'])
        return {'student_id': result['student']['id'], 'exam_id': next(iter(ids)) if len(ids) == 1 else None,
            'class_id': str(query.class_id) if query.class_id else None}
    return None


def _actor(user):
    if not user.is_active or user.role not in (UserRole.teacher, UserRole.student):
        # Existing AI Support does not permit admin data queries; do not expand it.
        raise HTTPException(403, 'Academic support is for active teachers and students')


def _owned_exams(user):
    return select(Exam.id).where(Exam.created_by == user.id, Exam.deleted_at.is_(None))


def authorized_students(user):
    _actor(user)
    query = select(User).where(User.role == UserRole.student)
    if user.role == UserRole.student:
        return query.where(User.id == user.id)
    exams = _owned_exams(user)
    own_classes = select(Class.id).where(Class.homeroom_teacher_id == user.id)
    assigned_classes = select(ExamAssignment.class_id).where(ExamAssignment.exam_id.in_(exams), ExamAssignment.class_id.is_not(None))
    return query.where(or_(
        User.id.in_(select(ClassEnrollment.student_id).where(or_(ClassEnrollment.class_id.in_(own_classes), ClassEnrollment.class_id.in_(assigned_classes)))),
        User.id.in_(select(ExamAssignment.student_id).where(ExamAssignment.exam_id.in_(exams), ExamAssignment.student_id.is_not(None))),
        User.id.in_(select(ExamAttempt.student_id).where(ExamAttempt.exam_id.in_(exams))),
    ))


def _student_classes(user, student_id):
    query = select(Class).join(ClassEnrollment, ClassEnrollment.class_id == Class.id).where(ClassEnrollment.student_id == student_id)
    if user.role == UserRole.teacher:
        query = query.where(or_(Class.homeroom_teacher_id == user.id, Class.id.in_(
            select(ExamAssignment.class_id).where(ExamAssignment.exam_id.in_(_owned_exams(user))))))
    return query


def _audit(db, user, query, tool, outcome, student_id=None):
    record_audit(db, action='AI_SUPPORT_DATA_ACCESS', user_id=user.id, entity_type='student', entity_id=student_id,
        metadata={'intent': query.intent, 'role': user.role.value, 'tool': tool, 'outcome': outcome,
            'exam_id': str(query.exam_id) if query.exam_id else None, 'class_id': str(query.class_id) if query.class_id else None,
            'success': outcome not in ('denied', 'unavailable')})


def _identity(student, classes):
    return {'id': str(student.id), 'name': student.full_name, 'student_code': student.student_code,
        'classes': [{'id': str(c.id), 'name': c.name} for c in classes]}


def search_authorized_students(db, user, query: Lookup):
    statement = authorized_students(user)
    if user.role == UserRole.student:
        own_name = normalized(user.full_name)
        matches = (not query.student_id or query.student_id == user.id) and (
            not query.student_code or query.student_code == user.student_code) and (
            not query.student_name or all(word in own_name.split() for word in normalized(query.student_name).split()))
        if not matches:
            _audit(db, user, query, 'search_authorized_students', 'denied')
            return {'status': 'denied', 'students': []}
    elif query.self_requested or not (query.student_id or query.student_code or query.student_name):
        _audit(db, user, query, 'search_authorized_students', 'needs_student')
        return {'status': 'needs_student', 'students': []}
    if query.student_id:
        statement = statement.where(User.id == query.student_id)
    elif query.student_code:
        statement = statement.where(User.student_code == query.student_code)
    elif query.student_name:
        for word in normalized(query.student_name).split():
            statement = search(statement, word, User.full_name)
    students = db.scalars(statement.options(load_only(User.id, User.full_name, User.student_code, raiseload=True))
        .order_by(User.full_name, User.id).limit(MAX_CHOICES + 1)).all()
    status = 'not_found' if not students else 'multiple' if len(students) > 1 else 'found'
    _audit(db, user, query, 'search_authorized_students', status, students[0].id if len(students) == 1 else None)
    return {'status': status, 'more': len(students) > MAX_CHOICES,
        'students': [_identity(s, db.scalars(_student_classes(user, s.id)).all()) for s in students[:MAX_CHOICES]]}


def _student_exams(user, student_id):
    _actor(user)
    student_classes = select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == student_id)
    assignments = select(ExamAssignment.exam_id).where(or_(ExamAssignment.student_id == student_id, ExamAssignment.class_id.in_(student_classes)))
    query = select(Exam).where(Exam.deleted_at.is_(None), or_(Exam.id.in_(assignments), Exam.id.in_(
        select(ExamAttempt.exam_id).where(ExamAttempt.student_id == student_id))))
    if user.role == UserRole.teacher:
        query = query.where(Exam.created_by == user.id)
    else:
        query = query.where(Exam.status != ExamStatus.draft)
    return query


def get_student_results(db, user, query: Lookup, student_id: UUID):
    # Independently authorize direct tool calls and follow-ups; a resolved ID is not permission.
    student = db.scalar(authorized_students(user).where(User.id == student_id)
        .options(load_only(User.id, User.full_name, User.student_code, raiseload=True)))
    if not student:
        _audit(db, user, query, 'get_student_results', 'denied')
        return {'status': 'not_found'}
    classes = db.scalars(_student_classes(user, student_id)).all()
    identity = _identity(student, classes)
    exams = _student_exams(user, student_id)
    if query.class_id or query.class_query:
        matched = _student_classes(user, student_id)
        if query.class_id:
            matched = matched.where(Class.id == query.class_id)
        else:
            for word in normalized(query.class_query).split():
                matched = search(matched, word, Class.name)
        matched = db.scalars(matched.order_by(Class.name, Class.id).limit(MAX_CHOICES + 1)).all()
        if len(matched) != 1:
            _audit(db, user, query, 'get_student_results', 'class_ambiguous' if matched else 'no_class', student_id)
            return {'status': 'choose_class' if matched else 'no_class', 'student': identity,
                'choices': [{'id': str(c.id), 'label': c.name, 'value': f'Lớp {c.id}'} for c in matched[:MAX_CHOICES]], 'more': len(matched) > MAX_CHOICES}
        exams = exams.where(Exam.id.in_(select(ExamAssignment.exam_id).where(ExamAssignment.class_id == matched[0].id)))
    if query.exam_id:
        exams = exams.where(Exam.id == query.exam_id)
    elif query.exam_query:
        # Course names can be class names as well as part of an exam title.
        class_matches = select(Class.id)
        title_matches = select(Exam.id)
        for word in normalized(query.exam_query).split():
            title_matches = search(title_matches, word, Exam.title)
            class_matches = search(class_matches, word, Class.name)
        exams = exams.where(or_(Exam.id.in_(title_matches), Exam.id.in_(
            select(ExamAssignment.exam_id).where(ExamAssignment.class_id.in_(class_matches)))))
        matched = db.scalars(exams.order_by(Exam.title, Exam.id).limit(MAX_CHOICES + 1)).all()
        if len(matched) != 1:
            _audit(db, user, query, 'get_student_results', 'exam_ambiguous' if matched else 'no_exam', student_id)
            return {'status': 'choose_exam' if matched else 'no_exam', 'student': identity,
                'choices': [{'id': str(e.id), 'label': f'{e.title} — {e.start_time:%d/%m/%Y}', 'value': f'Kỳ thi {e.id}'} for e in matched[:MAX_CHOICES]], 'more': len(matched) > MAX_CHOICES}
        exams = exams.where(Exam.id == matched[0].id)
    statement = select(ExamAttempt, Exam).join(Exam, Exam.id == ExamAttempt.exam_id).where(
        ExamAttempt.student_id == student_id, Exam.id.in_(exams.with_only_columns(Exam.id)))
    if query.date_range:
        from app.services.support_academic_queries import backend_now, date_window
        start, end = date_window(query.date_range, backend_now())
        timestamp = func.coalesce(ExamAttempt.started_at, ExamAttempt.created_at)
        statement = statement.where(timestamp >= start, timestamp < end)
    totals = {}
    if query.intent == 'STUDENT_ATTEMPT_HISTORY':
        matching = statement.with_only_columns(ExamAttempt.id, ExamAttempt.exam_id).subquery()
        count, exams_count = db.execute(select(func.count(), func.count(func.distinct(matching.c.exam_id))).select_from(matching)).one()
        totals = {'total_attempts': count, 'total_exams': exams_count}
    rows = db.execute(statement.order_by(ExamAttempt.created_at.desc(), ExamAttempt.id).limit(MAX_RESULTS + 1)).all()
    attempts = [a for a, _ in rows[:MAX_RESULTS]]
    metadata = student_result_metadata_many(db, attempts)
    classes_by_exam = {}
    for exam_id, class_name in db.execute(select(ExamAssignment.exam_id, Class.name).join(Class, Class.id == ExamAssignment.class_id)
            .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
            .where(ExamAssignment.exam_id.in_([a.exam_id for a in attempts]), ClassEnrollment.student_id == student_id).distinct()):
        classes_by_exam.setdefault(exam_id, []).append(class_name)
    results = []
    for attempt, exam in rows[:MAX_RESULTS]:
        stored = saved_attempt(attempt, None, {})
        meta = metadata[attempt.id]
        score = meta['final_score'] if user.role == UserRole.student else stored['score']
        results.append({'attempt_id': str(attempt.id), 'exam_id': str(exam.id), 'exam_name': exam.title,
            'classes': classes_by_exam.get(exam.id, []), 'attempt_number': attempt.attempt_number,
            'status': attempt.status.value, 'grading_pending': meta['grading_pending'],
            'score': str(score) if score is not None else None,
            'max_score': str(attempt.max_score) if attempt.max_score is not None else None,
            'started_at': attempt.started_at.isoformat() if attempt.started_at else None,
            'submitted_at': attempt.submitted_at.isoformat() if attempt.submitted_at else None,
            'route': f'/student/attempts/{attempt.id}/result' if user.role == UserRole.student and attempt.status in TERMINAL else
                     '/student/history' if user.role == UserRole.student else f'/dashboard/reports/attempts/{attempt.id}'})
    _audit(db, user, query, 'get_student_results', 'found' if results else 'empty', student_id)
    return {'status': 'results', 'student': identity, 'results': results, 'more': len(rows) > MAX_RESULTS, **totals}


def get_student_attempt_history(db, user, query: Lookup, student_id: UUID):
    return get_student_results(db, user, query.model_copy(update={'intent': 'STUDENT_ATTEMPT_HISTORY'}), student_id)


def execute_lookup(db, user, query: Lookup):
    if query.scope_error:
        _actor(user)
        _audit(db, user, query, 'academic_lookup', 'rejected')
        return {'status': 'scope_error', 'message': query.scope_error}
    if query.intent not in ('STUDENT_SCORE_LOOKUP', 'STUDENT_ATTEMPT_HISTORY'):
        from app.services.support_academic_queries import execute_query
        return execute_query(db, user, query)
    found = search_authorized_students(db, user, query)
    if found['status'] != 'found':
        return found
    tool = get_student_attempt_history if query.intent == 'STUDENT_ATTEMPT_HISTORY' else get_student_results
    return tool(db, user, query, UUID(found['students'][0]['id']))


def format_result(result, query: Lookup):
    """Only server-owned templates and fields from the authorized tool result."""
    status = result['status']
    source = {'id': 'academic-data', 'kind': 'system_data', 'title': 'Dữ liệu hệ thống', 'route': '', 'steps': [],
        'intent': query.intent, 'status': status, 'scope': {'students': [], 'exams': []}}
    pending = None
    if result.get('academic_report') or status in ('scope_error', 'choose_scope', 'no_scope'):
        from app.services.support_academic_queries import format_report
        return format_report(result, query, source)
    if status == 'denied':
        text = 'Bạn chỉ có thể xem kết quả của chính mình. Tôi không thể cung cấp kết quả của sinh viên khác.'
    elif status == 'needs_student':
        text = 'Bạn muốn xem kết quả của sinh viên nào? Vui lòng cho biết tên hoặc MSSV.'
        pending = {'lookup': query.model_dump(mode='json'), 'field': 'student_id', 'choices': []}
    elif status == 'not_found':
        text = 'Không tìm thấy sinh viên phù hợp trong các lớp hoặc kỳ thi bạn được phép quản lý.'
        pending = {'lookup': query.model_dump(mode='json'), 'field': 'student_id', 'choices': []}
    elif status == 'unavailable':
        text = 'Hiện không thể truy xuất dữ liệu này. Vui lòng thử lại hoặc liên hệ hỗ trợ.'
    elif status == 'multiple' or status.startswith('choose_'):
        if status == 'multiple':
            choices = [{'id': s['id'], 'label': ' — '.join(filter(None, [s['name'], s['student_code'], ', '.join(c['name'] for c in s['classes'])])),
                'value': f"MSSV {s['student_code']}" if s['student_code'] else f"Sinh viên {s['id']}"} for s in result['students']]
            field = 'student_id'
            text = f"Tôi tìm thấy {len(choices)} sinh viên phù hợp" + (' trong các kết quả đầu tiên' if result.get('more') else '') + '. Bạn muốn xem sinh viên nào?'
            source['scope']['students'] = [s['id'] for s in result['students']]
        else:
            choices = result['choices']; field = 'exam_id' if status == 'choose_exam' else 'class_id'
            query = query.model_copy(update={'student_id': UUID(result['student']['id'])})
            source['scope']['students'] = [result['student']['id']]
            if field == 'exam_id':
                source['scope']['exams'] = [c['id'] for c in choices]
            text = 'Có nhiều ' + ('kỳ thi' if field == 'exam_id' else 'lớp') + ' phù hợp. Bạn muốn xem mục nào?'
        text += '\n\n' + '\n'.join(f"{i + 1}. {c['label']}" for i, c in enumerate(choices))
        if result.get('more'):
            text += '\nCòn kết quả khác; hãy cung cấp MSSV hoặc tên cụ thể hơn.'
        source['choices'] = [{k: c[k] for k in ('label', 'value')} for c in choices]
        pending = {'lookup': query.model_dump(mode='json'), 'field': field, 'choices': choices}
    elif status in ('no_exam', 'no_class'):
        text = 'Không tìm thấy ' + ('kỳ thi' if status == 'no_exam' else 'lớp') + ' phù hợp với sinh viên này trong phạm vi bạn được phép xem.'
    else:
        student = result['student']; results = result['results']
        source['scope'] = {'students': [student['id']], 'exams': list(dict.fromkeys(r['exam_id'] for r in results))}
        text = student['name'] + (f" — MSSV {student['student_code']}" if student['student_code'] else '')
        if 'total_attempts' in result:
            text += f"\n{result['total_attempts']} lượt làm bài trong {result['total_exams']} đề thi."
        for row in results:
            value = f"{row['score']}/{row['max_score']}" if row['score'] is not None and row['max_score'] is not None else row['score']
            if value is None:
                value = 'Đang chấm' if row['grading_pending'] else 'Chưa có kết quả'
            elif row['grading_pending']:
                value += ' (điểm hiện có, đang chấm)'
            text += f"\n• {row['exam_name']} — lần {row['attempt_number']}: {value}"
            if row['classes']:
                text += ' · ' + ', '.join(row['classes'])
            if query.intent == 'STUDENT_ATTEMPT_HISTORY':
                labels = {'submitted': 'Đã nộp', 'auto_submitted': 'Tự động nộp', 'terminated': 'Đã kết thúc', 'in_progress': 'Đang làm', 'not_started': 'Chưa bắt đầu'}
                text += ' · ' + labels.get(row['status'], row['status'])
                if row['started_at']:
                    text += ' · Bắt đầu: ' + row['started_at']
                if row['submitted_at']:
                    text += ' · Nộp: ' + row['submitted_at']
        if results:
            text += f'\n\n{len(results)} lượt làm bài' + (' gần nhất; hãy nêu kỳ thi hoặc lớp để thu hẹp kết quả.' if result.get('more') else '.')
        else:
            text += '\n\nChưa có lượt làm bài trong phạm vi bạn được phép xem.'
        if len(results) == 1:
            source.update(title='Xem chi tiết kết quả', route=results[0]['route'])
        elif results:
            source['links'] = [{'label': f"{r['exam_name']} — lần {r['attempt_number']}", 'route': r['route']} for r in results[:6]]
    return text, [source], pending


def source_still_authorized(db, user, source):
    """Recheck restored transcripts after permissions, enrollment or exam ownership changes."""
    scope = source.get('scope', {})
    students = [UUID(value) for value in scope.get('students', [])]
    exams = [UUID(value) for value in scope.get('exams', [])]
    classes = [UUID(value) for value in scope.get('classes', [])]
    if classes:
        from app.services.support_academic_queries import authorized_classes
        if set(db.scalars(authorized_classes(user).with_only_columns(Class.id).where(Class.id.in_(classes)))) != set(classes):
            return False
    visible = set(db.scalars(authorized_students(user).with_only_columns(User.id).where(User.id.in_(students))))
    if visible != set(students):
        return False
    if exams:
        allowed = select(Exam.id).where(Exam.id.in_(exams), Exam.deleted_at.is_(None))
        if user.role == UserRole.teacher:
            allowed = allowed.where(Exam.created_by == user.id)
        else:
            from app.services.support_academic_queries import authorized_exams
            visibility = authorized_exams(user) if source.get('intent') in ('OPEN_EXAMS_LOOKUP', 'STUDENTS_NOT_ATTEMPTED') else _student_exams(user, user.id)
            allowed = allowed.where(Exam.id.in_(visibility.with_only_columns(Exam.id)))
        if set(db.scalars(allowed)) != set(exams):
            return False
    return True
