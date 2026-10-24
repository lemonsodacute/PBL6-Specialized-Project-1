"""Persist the question and option order for each attempt."""
from alembic import op

revision = '0002_attempt_question_order'
down_revision = '0001_schema'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute('ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS question_order_json JSONB')

def downgrade() -> None:
    op.execute('ALTER TABLE exam_attempts DROP COLUMN IF EXISTS question_order_json')
