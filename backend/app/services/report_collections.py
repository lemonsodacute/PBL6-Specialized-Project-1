"""SQL collection projection over persisted attempts; no grading/risk recalculation."""
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import case, cast, func, select, Numeric
from app.models.entities import (AttemptStatus, DetectionEvent, Exam, ExamAttempt, User, UserRole, ViolationLog)
from app.services.collections import search, ordered, page_query
from app.services.attempts import finalize_expired_attempt

TERMINAL=(AttemptStatus.submitted,AttemptStatus.auto_submitted,AttemptStatus.terminated)

def attempt_projection(db, user, exam_id=None, q='', status=None, risk_min=None, has_risk=None, student_scope=None):
    query=select(ExamAttempt).join(Exam,Exam.id==ExamAttempt.exam_id).join(User,User.id==ExamAttempt.student_id).where(Exam.deleted_at.is_(None))
    if user.role != UserRole.admin: query=query.where(Exam.created_by==user.id)
    if exam_id: query=query.where(ExamAttempt.exam_id==exam_id)
    if student_scope is not None:query=query.where(ExamAttempt.student_id.in_(student_scope))
    query=search(query,q,User.full_name,User.student_code,Exam.title)
    # Keep the same lazy expiry policy, restricted to this authorized scope.
    expired=db.scalars(query.where(ExamAttempt.status==AttemptStatus.in_progress,ExamAttempt.server_deadline_at < func.now())).all()
    changed=False
    for item in expired:changed=finalize_expired_attempt(db,item) or changed
    if changed:db.commit()
    if status:query=query.where(ExamAttempt.status==status)
    if risk_min is not None:query=query.where(ExamAttempt.risk_score>=risk_min)
    if has_risk is not None:query=query.where(ExamAttempt.risk_score.is_not(None) if has_risk else ExamAttempt.risk_score.is_(None))
    ids=query.with_only_columns(ExamAttempt.id).subquery()
    browser=select(ViolationLog.attempt_id,func.count().label('count')).where(ViolationLog.attempt_id.in_(select(ids.c.id))).group_by(ViolationLog.attempt_id).subquery()
    detector=select(DetectionEvent.attempt_id,func.count().label('count')).where(DetectionEvent.attempt_id.in_(select(ids.c.id)),DetectionEvent.source=='LEGACY').group_by(DetectionEvent.attempt_id).subquery()
    score=case((ExamAttempt.status.in_(TERMINAL),ExamAttempt.score),else_=None)
    percent=case((ExamAttempt.max_score>0,score/cast(ExamAttempt.max_score,Numeric)*100),else_=None)
    query=query.outerjoin(browser,browser.c.attempt_id==ExamAttempt.id).outerjoin(detector,detector.c.attempt_id==ExamAttempt.id)
    return query.with_only_columns(ExamAttempt.id.label('attempt_id'),ExamAttempt.exam_id,Exam.title.label('exam_title'),
        ExamAttempt.student_id,User.student_code,User.full_name,User.email.label('student_email'),ExamAttempt.attempt_number,
        ExamAttempt.status,score.label('score'),ExamAttempt.max_score,percent.label('percentage'),
        ExamAttempt.risk_score,ExamAttempt.started_at,ExamAttempt.submitted_at,
        func.coalesce(browser.c.count,0).label('browser_violation_count'),func.coalesce(detector.c.count,0).label('detection_count'),
        (func.coalesce(browser.c.count,0)+func.coalesce(detector.c.count,0)).label('violation_count'))

def projection_summary(db, query, single_exam=False):
    rows=query.order_by(None).subquery();complete=rows.c.status.in_(TERMINAL)
    data=db.execute(select(func.count().label('attempt_count'),func.sum(case((complete,1),else_=0)).label('completed_attempts'),
        func.count(rows.c.score).label('scored_attempts'),func.count(rows.c.percentage).label('percentage_attempts'),
        func.avg(rows.c.score).label('average_score'),func.avg(rows.c.percentage).label('average_percentage'),
        func.min(case((rows.c.score.is_not(None),rows.c.max_score))).label('min_max'),
        func.max(case((rows.c.score.is_not(None),rows.c.max_score))).label('max_max'),
        func.sum(rows.c.violation_count).label('total_violations'),func.sum(rows.c.browser_violation_count).label('browser_violation_count'),
        func.sum(rows.c.detection_count).label('detection_count'),func.avg(rows.c.risk_score).label('average_risk_score'),
        func.count(rows.c.risk_score).label('risk_scored_attempts'))).mappings().one()
    uniform=single_exam and data['scored_attempts']>0 and data['scored_attempts']==data['percentage_attempts'] and data['min_max']==data['max_max']
    result={key:(data[key] or 0) for key in ('attempt_count','completed_attempts','scored_attempts','percentage_attempts','total_violations','browser_violation_count','detection_count','risk_scored_attempts')}
    for key in ('average_percentage','average_risk_score'):
        result[key]=Decimal(str(data[key])).quantize(Decimal('0.01')) if data[key] is not None else None
    result['average_score']=Decimal(str(data['average_score'])).quantize(Decimal('0.01')) if uniform else None
    result['max_score']=data['max_max'] if uniform else None
    return result

def filtered_reports(db,user,exam_id,params,status,risk_min,has_risk):
    query=attempt_projection(db,user,exam_id,params.q,status,risk_min,has_risk)
    summary=projection_summary(db,query,exam_id is not None)
    scope=query.subquery()
    query=ordered(select(scope),params.sort,{'newest':scope.c.started_at.desc().nullslast(),'oldest':scope.c.started_at.asc().nullslast(),
        'submitted':scope.c.submitted_at.desc().nullslast(),'score_desc':scope.c.score.desc().nullslast(),'score_asc':scope.c.score.asc().nullslast(),
        'name':func.lower(scope.c.full_name).asc(),'risk':scope.c.risk_score.desc().nullslast()},scope.c.attempt_id)
    query,total=page_query(db,query,params.page,params.limit)
    data=[dict(row) for row in db.execute(query).mappings()]
    return summary,data,{'total':total,'page':params.page,'limit':params.limit}
