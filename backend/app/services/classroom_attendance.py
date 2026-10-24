"""One aggregate per student/session; accumulate only real connection intervals."""
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from app.models.entities import AttendanceStatus, ClassAttendance


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def close_interval(row, at):
    at = utc(at)
    if row.active_since:
        end = max(at, utc(row.active_since))
        row.duration_sec = (row.duration_sec or 0) + max(0, int((end - utc(row.active_since)).total_seconds()))
        row.left_at = end
        row.active_since = None
        row.last_event_at = end


def connected(db, session_id, student_id, sid, at=None):
    at = utc(at or datetime.now(timezone.utc))
    row = db.scalar(select(ClassAttendance).where(ClassAttendance.live_class_id == session_id, ClassAttendance.student_id == student_id).with_for_update())
    if not row:
        row = ClassAttendance(id=uuid4(), live_class_id=session_id, student_id=student_id, duration_sec=0)
        db.add(row)
    # Duplicate webhook/heartbeat or a stale event from a replaced connection.
    if row.participant_sid == sid or (row.last_event_at and at < utc(row.last_event_at)):
        return row
    close_interval(row, at)
    row.joined_at = row.joined_at or at
    row.active_since = at
    row.left_at = None
    row.participant_sid = sid
    row.last_event_at = at
    row.status = AttendanceStatus.present
    return row


def disconnected(db, session_id, student_id, sid, at=None):
    row = db.scalar(select(ClassAttendance).where(ClassAttendance.live_class_id == session_id, ClassAttendance.student_id == student_id).with_for_update())
    if row and row.participant_sid == sid:
        close_interval(row, at or datetime.now(timezone.utc))
    return row
