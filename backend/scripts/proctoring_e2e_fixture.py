"""Private disposable proctor fixture in the named release QA database only."""
import json
import re
import sys
from datetime import datetime,timedelta,timezone
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy.engine import make_url
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import create_access_token,hash_password
from app.models.entities import User,UserRole,Exam,ExamStatus,ExamAttempt,AttemptStatus,ExamAssignment,ProctoringSession


if settings.ENVIRONMENT not in {'development','test'} or not re.fullmatch(r'ai_procto_release_qa_[0-9a-f]{16}',make_url(settings.DATABASE_URL).database or ''):
    raise RuntimeError('Fixture is restricted to the isolated QA database')
with SessionLocal() as db:
    suffix=uuid4().hex[:12];actors={}
    for name,role in [('teacher',UserRole.teacher),('other',UserRole.teacher),('student',UserRole.student),('admin',UserRole.admin)]:
        user=User(id=uuid4(),email=f'proctor-e2e-{suffix}-{name}@example.test',full_name=f'Proctor QA {name}',
            password_hash=hash_password(uuid4().hex),role=role,is_active=True,
            student_code=f'PQA{suffix.upper()}' if name=='student' else None)
        db.add(user);db.flush()
        actors[name]={'id':str(user.id),'full_name':user.full_name,'email':user.email,'role':role.value,
            'is_active':True,'student_code':user.student_code,'access_token':create_access_token(str(user.id),role.value)}
    now=datetime.now(timezone.utc)
    exam=Exam(id=uuid4(),title='Proctor alerts · QA isolated',created_by=actors['teacher']['id'],
        start_time=now-timedelta(minutes=5),end_time=now+timedelta(hours=2),duration_minutes=60,
        status=ExamStatus.ongoing,require_camera=True,require_mic=False,max_attempts=1,extra_settings_json={'show_answers':False})
    db.add(exam);db.flush()
    attempt=ExamAttempt(id=uuid4(),exam_id=exam.id,student_id=actors['student']['id'],attempt_number=1,status=AttemptStatus.in_progress,
        started_at=now-timedelta(minutes=1),server_deadline_at=now+timedelta(hours=1),max_score=10,violation_count=0)
    db.add(attempt);db.flush()
    db.add_all([ExamAssignment(id=uuid4(),exam_id=exam.id,student_id=attempt.student_id),
        ProctoringSession(id=uuid4(),attempt_id=attempt.id,started_at=attempt.started_at,camera_enabled=True)])
    db.commit()
    target=Path(__file__).resolve().parents[1]/'private'/'release-qa'/'proctor-fixture.json'
    target.write_text(json.dumps({'actors':actors,'exam_id':str(exam.id),'attempt_id':str(attempt.id)}),encoding='utf8')
    print(json.dumps({'fixture_saved':True,'exam_id':str(exam.id),'attempt_id':str(attempt.id)}))
