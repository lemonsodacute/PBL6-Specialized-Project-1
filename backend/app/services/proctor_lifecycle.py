"""Observe committed attempt status changes without changing exam/grading behavior."""
import asyncio
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session
from app.models.entities import Exam, ExamAttempt
from app.services.proctor_events import recipients
from app.services import proctor_realtime as realtime


@event.listens_for(Session,'after_flush')
def attempt_status_changed(db, _context):
    for row in list(db.new)+list(db.dirty):
        if not isinstance(row,ExamAttempt) or not row.id or not inspect(row).attrs.status.history.has_changes(): continue
        exam=db.get(Exam,row.exam_id)
        if not exam: continue
        message={'type':'attempt_update','data':{'exam_id':str(exam.id),'attempt_id':str(row.id),'status':getattr(row.status,'value',row.status)},
            'recipients':[str(value) for value in recipients(db,exam)]}
        realtime.enqueue(db,message)
        if db.bind.dialect.name!='postgresql': db.info.setdefault('proctor_lifecycle',[]).append(message)


@event.listens_for(Session,'after_commit')
def committed(db):
    for message in db.info.pop('proctor_lifecycle',[]):
        try:
            from anyio import from_thread
            from_thread.run(realtime.deliver,message)
        except RuntimeError:
            try: asyncio.get_running_loop().create_task(realtime.deliver(message))
            except RuntimeError: pass  # A synchronous test/CLI with no live sockets.


@event.listens_for(Session,'after_rollback')
def rolled_back(db):
    db.info.pop('proctor_lifecycle',None)
