"""add microphone requirement to exams"""
from alembic import op
import sqlalchemy as sa

revision = '0003_exam_require_mic'
down_revision = '0002_attempt_question_order'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('exams', sa.Column('require_mic', sa.Boolean(), nullable=False, server_default=sa.text('FALSE')))

def downgrade() -> None:
    op.drop_column('exams', 'require_mic')
