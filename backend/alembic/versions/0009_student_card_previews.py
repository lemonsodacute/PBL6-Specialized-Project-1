"""Private student-card preview metadata; no active references or OCR execution."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0009_student_card_previews'
down_revision = '0008_student_identity_profile'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'student_card_previews',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('identity_profile_version', sa.Integer(), nullable=False),
        sa.Column('original_image_key', sa.String(96), nullable=False),
        sa.Column('card_preview_key', sa.String(96), nullable=False),
        sa.Column('face_preview_key', sa.String(96), nullable=False),
        sa.Column('image_sha256', sa.String(64), nullable=False),
        sa.Column('extracted_json', postgresql.JSONB(), nullable=False),
        sa.Column('confidence_json', postgresql.JSONB()),
        sa.Column('validation_json', postgresql.JSONB(), nullable=False),
        sa.Column('ocr_model_version', sa.String(128), nullable=False),
        sa.Column('parser_version', sa.String(64), nullable=False),
        sa.Column('matching_version', sa.String(64), nullable=False),
        sa.CheckConstraint("status IN ('PENDING', 'SUPERSEDED', 'INVALIDATED', 'EXPIRED', 'CONFIRMED')", name='ck_student_card_preview_status'),
        sa.CheckConstraint('expires_at > created_at', name='ck_student_card_preview_ttl'),
        sa.CheckConstraint('identity_profile_version >= 1', name='ck_student_card_preview_profile_version'),
    )
    op.create_index('idx_student_card_previews_owner', 'student_card_previews', ['student_id', 'status'])
    op.create_index('idx_student_card_previews_expiry', 'student_card_previews', ['expires_at'])
    op.create_index('uq_student_card_preview_pending', 'student_card_previews', ['student_id'], unique=True, postgresql_where=sa.text("status = 'PENDING'"))


def downgrade() -> None:
    op.drop_table('student_card_previews')
