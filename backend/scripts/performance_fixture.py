"""Bounded performance data, only in the explicitly isolated release-QA database."""
import json
from pathlib import Path
import re
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.engine import make_url
from app.core.config import settings
from app.core.database import SessionLocal
from app.models.entities import Class, ClassEnrollment, QuestionBank, Question, QuestionType

database = make_url(settings.DATABASE_URL).database
if not re.fullmatch(r'ai_procto_release_qa_[0-9a-f]{16}', database or ''):
    raise SystemExit('Performance fixtures require the isolated QA runtime')
demo = json.loads(Path('private/release-qa/demo-accounts.json').read_text('utf-8'))
teacher_id = UUID(demo['actors']['teacher']['id'])
student_id = UUID(demo['actors']['student']['id'])
with SessionLocal() as db:
    for index in range(20):
        label = f'PERF QA {index:02d}'
        cls = db.scalar(select(Class).where(Class.name == label, Class.homeroom_teacher_id == teacher_id))
        if cls is None:
            cls = Class(name=label, description='Isolated performance fixture', homeroom_teacher_id=teacher_id)
            db.add(cls); db.flush()
            db.add(ClassEnrollment(class_id=cls.id, student_id=student_id))
        bank = db.scalar(select(QuestionBank).where(QuestionBank.name == label, QuestionBank.created_by == teacher_id))
        if bank is None:
            bank = QuestionBank(name=label, description='Isolated performance fixture', created_by=teacher_id)
            db.add(bank); db.flush()
            db.add(Question(question_bank_id=bank.id, type=QuestionType.mcq_single, content=label,
                            default_points=1, options_json={'options': ['HTTP', 'SQL']}, correct_answer_json={'selected': 'HTTP'}))
    db.commit()
print(json.dumps({'isolated_qa': True, 'fixture_classes': 20, 'fixture_banks': 20}))
