from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import DetectionEvent, ExamAttempt, ProctoringSession, SeverityLevel, ViolationLog

# One source of truth for the risk model. Adjusting these values changes only
# the monitoring risk score; it never changes the exam grade.
SEVERITY_WEIGHTS: dict[SeverityLevel, Decimal] = {
    SeverityLevel.low: Decimal('1.0'),
    SeverityLevel.medium: Decimal('3.0'),
    SeverityLevel.high: Decimal('7.0'),
    SeverityLevel.critical: Decimal('10.0'),
}
VIOLATION_WEIGHT = Decimal('2.0')
DETECTION_WEIGHT = Decimal('10.0')


def calculate_risk_score(db: Session, attempt_id) -> Decimal:
    violations = db.scalars(select(ViolationLog).where(ViolationLog.attempt_id == attempt_id)).all()
    detections = db.scalars(select(DetectionEvent).where(DetectionEvent.attempt_id == attempt_id, DetectionEvent.source == 'LEGACY')).all()
    violation_risk = sum((SEVERITY_WEIGHTS.get(row.severity, Decimal('1')) * VIOLATION_WEIGHT for row in violations), Decimal('0'))
    detection_risk = sum((
        SEVERITY_WEIGHTS.get(row.severity, Decimal('1'))
        * Decimal(str(row.confidence_score or 0))
        * DETECTION_WEIGHT
        for row in detections
    ), Decimal('0'))
    return min(Decimal('100'), violation_risk + detection_risk).quantize(Decimal('0.01'))


def update_risk_score(db: Session, attempt: ExamAttempt, session: ProctoringSession | None = None) -> Decimal:
    score = calculate_risk_score(db, attempt.id)
    attempt.risk_score = score
    if session is not None:
        session.overall_risk_score = score
    else:
        session = db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt.id))
        if session:
            session.overall_risk_score = score
    return score
