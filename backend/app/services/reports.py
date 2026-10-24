from decimal import Decimal
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import func, select, case, cast, String, or_, union_all, literal, Numeric
from sqlalchemy.orm import aliased
from app.services.collections import search, ordered, page_query
from sqlalchemy.orm import Session
from app.models.entities import (Answer, AttemptStatus, Class, ClassEnrollment, DetectionEvent, Exam,
    ExamAssignment, ExamAttempt, ExamQuestion, Question, QuestionType, User, UserRole, ViolationLog)
from app.services.attempts import finalize_expired_attempt

TERMINAL = (AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated)

def event_counts(db: Session, attempt_ids) -> dict:
    """Count stored browser violations and detector alerts, not the cached trigger counter."""
    ids = list(attempt_ids)
    counts = {attempt_id: {'browser_violation_count': 0, 'detection_count': 0} for attempt_id in ids}
    if ids:
        for model, key in ((ViolationLog, 'browser_violation_count'), (DetectionEvent, 'detection_count')):
            for attempt_id, count in db.execute(select(model.attempt_id, func.count()).where(model.attempt_id.in_(ids), *([DetectionEvent.source == 'LEGACY'] if model is DetectionEvent else [])).group_by(model.attempt_id)):
                counts[attempt_id][key] = count
    return {attempt_id: {**count, 'violation_count': sum(count.values())} for attempt_id, count in counts.items()}

def saved_attempt(attempt: ExamAttempt, student: User | None, counts: dict) -> dict:
    terminal = attempt.status in TERMINAL
    score = attempt.score if terminal else None
    percentage = (score / attempt.max_score * Decimal('100')) if score is not None and attempt.max_score is not None and attempt.max_score > 0 else None
    return {'id': attempt.id, 'attempt_id': attempt.id, 'student_id': attempt.student_id,
            'student_name': student.full_name if student else None, 'full_name': student.full_name if student else None,
            'student_code': student.student_code if student else None, 'student_email': student.email if student else None,
            'attempt_number': attempt.attempt_number, 'status': attempt.status,
            'score': score, 'max_score': attempt.max_score, 'percentage': percentage,
            'risk_score': attempt.risk_score, 'started_at': attempt.started_at, 'submitted_at': attempt.submitted_at,
            **counts}

def aggregate(rows: list[dict], single_exam: bool) -> dict:
    completed = [row for row in rows if row['status'] in TERMINAL]
    scores = [row['score'] for row in completed if row['score'] is not None]
    percentages = [row['percentage'] for row in completed if row['percentage'] is not None]
    risks = [row['risk_score'] for row in rows if row['risk_score'] is not None]
    scales = {row['max_score'] for row in completed if row['score'] is not None}
    uniform_scale = single_exam and len(scales) == 1 and None not in scales and next(iter(scales)) > 0
    average = lambda values: (sum(values) / len(values)).quantize(Decimal('0.01')) if values else None
    return {'completed_attempts': len(completed), 'scored_attempts': len(scores),
            'percentage_attempts': len(percentages), 'average_percentage': average(percentages),
            'average_score': average(scores) if uniform_scale else None,
            'max_score': next(iter(scales)) if uniform_scale else None,
            'total_violations': sum(row['violation_count'] for row in rows),
            'browser_violation_count': sum(row['browser_violation_count'] for row in rows),
            'detection_count': sum(row['detection_count'] for row in rows),
            'average_risk_score': average(risks), 'risk_scored_attempts': len(risks),
            'attempt_count': len(rows)}

def reports_overview(db: Session, user: User, exam_id: UUID | None = None,params=None,status=None,risk_min=None,has_risk=None) -> dict:
    # Match the existing exam-management permission: creator manages the exam;
    # assigned class/direct students and historical participants belong to that exam.
    query = select(Exam).where(Exam.deleted_at.is_(None))
    if user.role != UserRole.admin:
        query = query.where(Exam.created_by == user.id)
    exams = []
    if exam_id:
        _exam_for_user(exam_id, db, user)
    if params is not None and (params.page is not None or params.q or status or risk_min is not None or has_risk is not None):
        from app.services.report_collections import filtered_reports
        summary,rows,meta=filtered_reports(db,user,exam_id,params,status,risk_min,has_risk)
        exams=db.scalars(query.order_by(Exam.created_at.desc(),Exam.id).limit(20)).all()
        if exam_id and not any(exam.id==exam_id for exam in exams):
            exams.append(_exam_for_user(exam_id,db,user))
        return {'exams':[{'id':exam.id,'title':exam.title,'classes':[]} for exam in exams],
                'exam_id':exam_id,'completed_statuses':list(TERMINAL),'summary':summary,'results':rows,'meta':meta}
    exams = db.scalars(query.order_by(Exam.created_at.desc(), Exam.id)).all()
    selected = [exam for exam in exams if exam_id is None or exam.id == exam_id]
    selected_ids = [exam.id for exam in selected]
    attempts = db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id.in_(selected_ids))
                         .order_by(ExamAttempt.started_at.desc(), ExamAttempt.id)).all() if selected_ids else []
    # Keep report reads aligned with the existing Results/Student expiry behavior.
    changed = False
    for attempt in attempts:
        if attempt.status == AttemptStatus.in_progress:
            changed = finalize_expired_attempt(db, attempt) or changed
    if changed:
        db.commit()
    users = {row.id: row for row in db.scalars(select(User).where(User.id.in_({a.student_id for a in attempts}))).all()} if attempts else {}
    telemetry = event_counts(db, [a.id for a in attempts])
    exam_map = {exam.id: exam for exam in selected}
    rows = [{**saved_attempt(attempt, users.get(attempt.student_id), telemetry[attempt.id]),
             'exam_id': attempt.exam_id, 'exam_title': exam_map[attempt.exam_id].title} for attempt in attempts]
    assignments = db.execute(select(ExamAssignment.exam_id, Class.id, Class.name)
                            .join(Class, Class.id == ExamAssignment.class_id)
                            .where(ExamAssignment.exam_id.in_([exam.id for exam in exams]))).all() if exams else []
    classes = {}
    for eid, cid, name in assignments:
        classes.setdefault(eid, []).append({'id': cid, 'name': name})
    return {'exams': [{'id': exam.id, 'title': exam.title, 'classes': classes.get(exam.id, [])} for exam in exams],
            'exam_id': exam_id, 'completed_statuses': list(TERMINAL),
            'summary': aggregate(rows, exam_id is not None), 'results': rows}

def attempt_report(attempt_id: UUID, db: Session, user: User, params=None, severity=None, source=None) -> dict:
    attempt = db.get(ExamAttempt, attempt_id)
    if not attempt:
        raise HTTPException(404, detail={'code':'NOT_FOUND', 'message':'Attempt not found', 'details':None})
    exam = _exam_for_user(attempt.exam_id, db, user)
    if finalize_expired_attempt(db, attempt):
        db.commit()
    if params is not None and params.page is not None:
        browser=select(ViolationLog.id,literal('browser').label('source'),cast(ViolationLog.type,String).label('type'),cast(ViolationLog.severity,String).label('severity'),ViolationLog.occurred_at,cast(literal(None),Numeric).label('confidence')).where(ViolationLog.attempt_id==attempt.id)
        detector=select(DetectionEvent.id,literal('detector').label('source'),cast(DetectionEvent.event_type,String).label('type'),cast(DetectionEvent.severity,String).label('severity'),DetectionEvent.occurred_at,DetectionEvent.confidence_score.label('confidence')).where(DetectionEvent.attempt_id==attempt.id,DetectionEvent.source=='LEGACY')
        scope=union_all(browser,detector).subquery()
        query=select(scope)
        if severity:query=query.where(scope.c.severity==severity.value)
        if source:query=query.where(scope.c.source==source)
        query=ordered(query,params.sort,{'newest':scope.c.occurred_at.desc(),'oldest':scope.c.occurred_at.asc()},scope.c.id)
        query,total=page_query(db,query,params.page,params.limit)
        events=[dict(row) for row in db.execute(query).mappings()]
        return {**saved_attempt(attempt,db.get(User,attempt.student_id),event_counts(db,[attempt.id])[attempt.id]),
                'exam_id':exam.id,'exam_title':exam.title,'events':events,'meta':{'total':total,'page':params.page,'limit':params.limit}}
    browser = db.scalars(select(ViolationLog).where(ViolationLog.attempt_id == attempt.id).order_by(ViolationLog.occurred_at, ViolationLog.id)).all()
    detector = db.scalars(select(DetectionEvent).where(DetectionEvent.attempt_id == attempt.id, DetectionEvent.source == 'LEGACY').order_by(DetectionEvent.occurred_at, DetectionEvent.id)).all()
    events = [{'id': row.id, 'source': 'browser', 'type': row.type, 'severity': row.severity,
               'occurred_at': row.occurred_at, 'confidence': None} for row in browser]
    events += [{'id': row.id, 'source': 'detector', 'type': row.event_type, 'severity': row.severity,
                'occurred_at': row.occurred_at, 'confidence': row.confidence_score} for row in detector]
    events.sort(key=lambda row: (row['occurred_at'], str(row['id'])))
    return {**saved_attempt(attempt, db.get(User, attempt.student_id),
                           {'browser_violation_count': len(browser), 'detection_count': len(detector),
                            'violation_count': len(browser) + len(detector)}),
            'exam_id': exam.id, 'exam_title': exam.title, 'events': events}

def _exam_for_user(exam_id: UUID, db: Session, user: User) -> Exam:
    exam = db.get(Exam, exam_id)
    if not exam or exam.deleted_at: raise HTTPException(404, detail={'code':'NOT_FOUND','message':'Exam not found','details':None})
    if user.role != UserRole.admin and exam.created_by != user.id: raise HTTPException(403, detail={'code':'FORBIDDEN','message':'You do not own this exam','details':None})
    return exam

def roster_query(exam_id, params, status, grading):
    latest=aliased(ExamAttempt)
    latest_id=select(ExamAttempt.id).where(ExamAttempt.exam_id == exam_id,ExamAttempt.student_id == User.id).order_by(ExamAttempt.attempt_number.desc(),ExamAttempt.id).limit(1).correlate(User).scalar_subquery()
    current=func.coalesce(cast(latest.status,String),'not_started')
    visible_score=case((latest.status.in_(TERMINAL),latest.score),else_=None)
    historical=select(ExamAttempt.student_id).where(ExamAttempt.exam_id == exam_id)
    direct=select(ExamAssignment.student_id).where(ExamAssignment.exam_id == exam_id)
    enrolled=select(ClassEnrollment.student_id).where(ClassEnrollment.class_id.in_(select(ExamAssignment.class_id).where(ExamAssignment.exam_id == exam_id)))
    query=search(select(User.id.label('student_id'),current.label('state')).outerjoin(latest,latest.id == latest_id)
                 .where(or_(User.id.in_(historical),User.id.in_(direct),User.id.in_(enrolled))),params.q,User.full_name,User.student_code,User.email)
    pending=select(Answer.id).join(Question,Question.id == Answer.question_id).join(ExamQuestion,ExamQuestion.question_id == Answer.question_id).where(Answer.attempt_id == latest.id,Answer.points_awarded.is_(None),ExamQuestion.exam_id == exam_id,Question.type.in_((QuestionType.essay,QuestionType.oral))).exists()
    if status: query=query.where(current == status.value)
    if grading == 'pending': query=query.where(latest.status.in_(TERMINAL),pending)
    if grading == 'graded': query=query.where(latest.status.in_(TERMINAL),latest.score.is_not(None),~pending)
    return query,latest,visible_score

def roster_page(exam_id, db, params, status, grading):
    query,latest,visible_score=roster_query(exam_id,params,status,grading)
    scope=query.subquery()
    counts=db.execute(select(func.count(),func.sum(case((scope.c.state.in_([item.value for item in TERMINAL]),1),else_=0)),func.sum(case((scope.c.state=='in_progress',1),else_=0)),func.sum(case((scope.c.state=='not_started',1),else_=0)))).one()
    summary=dict(zip(('student_count','submitted_count','in_progress_count','not_started_count'),(value or 0 for value in counts)))
    query=ordered(query,params.sort,{'name':func.lower(User.full_name).asc(),'newest':latest.submitted_at.desc().nullslast(),'oldest':latest.submitted_at.asc().nullslast(),'submitted':latest.submitted_at.desc().nullslast(),'score_desc':visible_score.desc().nullslast(),'score_asc':visible_score.asc().nullslast()},User.id)
    query,total=page_query(db,query,params.page,params.limit)
    return [row.student_id for row in db.execute(query)],summary,{'total':total,'page':params.page,'limit':params.limit}


def _report(exam_id: UUID, db: Session, user: User, params=None, status=None, grading=None) -> dict:
    exam = _exam_for_user(exam_id, db, user)
    # Finalize only overdue records, using the unchanged grading/expiry service.
    expired=db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id == exam_id,ExamAttempt.status == AttemptStatus.in_progress,ExamAttempt.server_deadline_at < func.now())).all()
    changed = False
    for attempt in expired:
        changed = finalize_expired_attempt(db, attempt) or changed
    if changed:
        db.commit()
    paged=params is not None and (params.page is not None or params.q or status or grading)
    selected_ids,filtered_summary,meta=roster_page(exam_id,db,params,status,grading) if paged else (None,None,None)
    attempt_query=select(ExamAttempt).where(ExamAttempt.exam_id == exam_id)
    if paged: attempt_query=attempt_query.where(ExamAttempt.student_id.in_(selected_ids))
    attempts = db.scalars(attempt_query.order_by(ExamAttempt.attempt_number)).all()
    assignments = db.scalars(select(ExamAssignment).where(ExamAssignment.exam_id == exam_id)).all()
    class_ids = {assignment.class_id for assignment in assignments if assignment.class_id}
    classes = db.scalars(select(Class).where(Class.id.in_(class_ids)).order_by(Class.name)).all() if class_ids else []
    enrollments = db.scalars(select(ClassEnrollment).where(ClassEnrollment.class_id.in_(class_ids))).all() if class_ids and not paged else []
    # Include assigned students with no attempt, deduplicate overlapping class/direct assignments,
    # and retain historical participants if their enrollment has since been removed.
    student_ids = ({attempt.student_id for attempt in attempts}
                   | {assignment.student_id for assignment in assignments if assignment.student_id}
                   | {enrollment.student_id for enrollment in enrollments})
    if paged: student_ids=set(selected_ids)
    users = {student.id: student for student in db.scalars(select(User).where(User.id.in_(student_ids))).all()} if student_ids else {}
    question_links = db.execute(select(ExamQuestion, Question.type).join(Question, Question.id == ExamQuestion.question_id)
                               .where(ExamQuestion.exam_id == exam_id)).all()
    question_ids = {link.question_id for link, _ in question_links}
    objective_ids = {link.question_id for link, kind in question_links if kind in (QuestionType.mcq_single, QuestionType.mcq_multi)}
    manual_ids = question_ids - objective_ids
    exam_max_score = sum((Decimal(link.points) for link, _ in question_links), Decimal('0'))
    answer_rows = db.scalars(select(Answer).where(Answer.attempt_id.in_([attempt.id for attempt in attempts]),
                                                Answer.question_id.in_(question_ids))).all() if attempts and question_ids else []
    answers_by_attempt = {}
    for answer in answer_rows:
        answers_by_attempt.setdefault(answer.attempt_id, {})[answer.question_id] = answer
    ranking=select(ExamAttempt.id,func.row_number().over(order_by=(ExamAttempt.score.desc(),ExamAttempt.id)).label('rank')).where(ExamAttempt.exam_id == exam_id,ExamAttempt.status.in_(TERMINAL),ExamAttempt.score.is_not(None)).subquery()
    ranks=dict(db.execute(select(ranking.c.id,ranking.c.rank).where(ranking.c.id.in_([a.id for a in attempts]))).all()) if attempts else {}
    rows = []
    telemetry = event_counts(db, [attempt.id for attempt in attempts])
    for attempt in attempts:
        student = users.get(attempt.student_id)
        terminal = attempt.status in TERMINAL
        saved_answers = answers_by_attempt.get(attempt.id, {})
        rows.append({'correct_count':sum(a.is_correct is True for qid, a in saved_answers.items() if qid in objective_ids) if terminal and objective_ids else None,
                     'total_questions':len(question_ids), 'objective_question_count':len(objective_ids),
                     'pending_manual_count':sum(qid in saved_answers and saved_answers[qid].points_awarded is None for qid in manual_ids) if terminal else 0,
                     'rank':ranks.get(attempt.id),
                     **saved_attempt(attempt, student, telemetry[attempt.id])})
    by_student = {}
    for row in rows:
        by_student.setdefault(row['student_id'], []).append(row)
    results = []
    for student in sorted(users.values(), key=lambda item: (item.full_name.casefold(), str(item.id))):
        history = sorted(by_student.get(student.id, []), key=lambda item: item['attempt_number'], reverse=True)
        # Match the existing Student exam summary's latest-attempt ordering. This is a
        # current-state view, not a highest-score/first-score grading policy; expose ALL attempts.
        current = history[0] if history else {
            'student_id':student.id, 'full_name':student.full_name, 'student_name':student.full_name,
            'student_code':student.student_code, 'student_email':student.email,
            'attempt_id':None, 'attempt_number':None, 'status':AttemptStatus.not_started,
            'started_at':None, 'submitted_at':None, 'score':None, 'max_score':exam_max_score,
            'correct_count':None, 'total_questions':len(question_ids), 'objective_question_count':len(objective_ids),
            'pending_manual_count':0,
        }
        results.append({**current, 'attempts':history})
    if paged:
        order={student_id:index for index,student_id in enumerate(selected_ids)}
        results.sort(key=lambda row:order[row['student_id']])
    summary = {
        'student_count':len(results),
        'submitted_count':sum(row['status'] in TERMINAL for row in results),
        'in_progress_count':sum(row['status'] == AttemptStatus.in_progress for row in results),
        'not_started_count':sum(row['status'] == AttemptStatus.not_started for row in results),
    }
    if paged: summary=filtered_summary
    completed = [a for a in attempts if a.status in TERMINAL and a.score is not None]
    scores = [float(a.score) for a in completed]
    statistics = aggregate(rows, True)
    highest,lowest=max(scores) if scores else None,min(scores) if scores else None
    if paged:
        from app.services.report_collections import attempt_projection,projection_summary
        roster,_,_=roster_query(exam_id,params,status,grading)
        projection=attempt_projection(db,user,exam_id,student_scope=roster.with_only_columns(User.id))
        statistics=projection_summary(db,projection,True)
        scope=projection.subquery()
        highest,lowest=db.execute(select(func.max(scope.c.score),func.min(scope.c.score))).one()
    return {'exam': {'id':exam.id,'title':exam.title,'start_time':exam.start_time,'end_time':exam.end_time,
                     'max_score':exam_max_score, 'max_attempts':exam.max_attempts,
                     'classes':[{'id':item.id, 'name':item.name} for item in classes]},
            'summary':summary, 'results':results,'meta':meta,
            'statistics': {**statistics, 'completed_count':statistics['completed_attempts'],
                           'highest_score':highest,'lowest_score':lowest}, 'attempts':rows}

