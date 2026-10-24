"""Verify data-preserving 0022->0023 migration in the isolated QA DB only."""
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy import text
from sqlalchemy.engine import make_url
from alembic import command
from alembic.config import Config
from app.core.config import settings
from app.core.database import engine

if not re.fullmatch(r'ai_procto_release_qa_[0-9a-f]{16}',make_url(settings.DATABASE_URL).database or ''):
    raise RuntimeError('Migration verification is restricted to the isolated QA database')
columns='id,attempt_id,proctoring_session_id,event_type::text,confidence_score,severity::text,snapshot_url,metadata_json::text,occurred_at'
with engine.connect() as connection:
    assert connection.scalar(text("SELECT count(*) FROM detection_events WHERE source<>'LEGACY'"))==0,'Run before seeding normalized QA events'
    before=connection.execute(text('SELECT '+columns+' FROM detection_events ORDER BY id')).all()
    scores=connection.execute(text('SELECT id,score,risk_score,violation_count FROM exam_attempts ORDER BY id')).all()
config=Config('alembic.ini')
command.downgrade(config,'0022_support_session_lifecycle')
command.upgrade(config,'head')
with engine.connect() as connection:
    assert connection.execute(text('SELECT '+columns+' FROM detection_events ORDER BY id')).all()==before
    assert connection.execute(text('SELECT id,score,risk_score,violation_count FROM exam_attempts ORDER BY id')).all()==scores
    assert connection.scalar(text('SELECT count(*) FROM detection_events WHERE exam_id IS NULL OR student_id IS NULL'))==0
    assert connection.scalar(text('SELECT count(*) FROM detection_events WHERE first_seen<>occurred_at OR last_seen<>occurred_at'))==0
print(f'Migration round-trip PASS: {len(before)} legacy detections and {len(scores)} attempt score/counter records preserved.')
