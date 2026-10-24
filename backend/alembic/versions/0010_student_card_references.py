"""Version metadata for confirmed cards; keep the existing embedding store."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0010_student_card_references'
down_revision = '0009_student_card_previews'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('student_card_references',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('identity_profile_version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sanitized_face', sa.LargeBinary()),
        sa.CheckConstraint("status IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')", name='ck_card_reference_status'),
        sa.CheckConstraint('identity_profile_version >= 1', name='ck_card_reference_profile_version'))
    op.create_index('uq_card_reference_active', 'student_card_references', ['student_id'], unique=True, postgresql_where=sa.text("status = 'ACTIVE'"))
    # NULL deliberately leaves every pre-existing embedding/verification untrusted.
    op.add_column('student_face_embeddings', sa.Column('reference_version', postgresql.UUID(as_uuid=True)))
    op.create_foreign_key('fk_embedding_reference', 'student_face_embeddings', 'student_card_references', ['reference_version'], ['id'])
    op.add_column('identity_verifications', sa.Column('reference_version', postgresql.UUID(as_uuid=True)))
    op.create_foreign_key('fk_verification_reference', 'identity_verifications', 'student_card_references', ['reference_version'], ['id'])


def downgrade():
    op.drop_constraint('fk_verification_reference', 'identity_verifications', type_='foreignkey')
    op.drop_column('identity_verifications', 'reference_version')
    op.drop_constraint('fk_embedding_reference', 'student_face_embeddings', type_='foreignkey')
    op.drop_column('student_face_embeddings', 'reference_version')
    op.drop_table('student_card_references')
