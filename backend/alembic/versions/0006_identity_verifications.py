"""Persist per-exam student identity verification requests."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0006_identity_verifications'
down_revision = '0005_student_identities'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Support both the original schema.sql baseline and older installations.
    if sa.inspect(op.get_bind()).has_table('identity_verifications'):
        return
    op.create_table(
        'identity_verifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('exam_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('exams.id', ondelete='CASCADE'), nullable=False),
        sa.Column('image_path', sa.Text()),
        sa.Column('liveness_json', postgresql.JSONB()),
        sa.Column('status', sa.String(40), nullable=False, server_default=sa.text("'pending_model'")),
        sa.Column('score', sa.Numeric(5, 4)),
        sa.Column('failure_reason', sa.Text()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('idx_identity_verifications_student_exam', 'identity_verifications', ['student_id', 'exam_id'])
    op.create_index('idx_identity_verifications_created', 'identity_verifications', ['created_at'])

def downgrade() -> None:
    op.drop_index('idx_identity_verifications_created', table_name='identity_verifications')
    op.drop_index('idx_identity_verifications_student_exam', table_name='identity_verifications')
    op.drop_table('identity_verifications')
