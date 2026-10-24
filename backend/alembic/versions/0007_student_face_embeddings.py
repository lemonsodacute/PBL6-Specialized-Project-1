"""Add versioned face embedding storage without changing identity verification."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0007_student_face_embeddings'
down_revision = '0006_identity_verifications'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration schema is frozen; do not import mutable runtime model constants.
    op.create_table(
        'student_face_embeddings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('embedding', sa.LargeBinary(), nullable=False),
        sa.Column('model_name', sa.String(64), nullable=False),
        sa.Column('model_version', sa.String(64), nullable=False),
        sa.Column('preprocessing_version', sa.String(128), nullable=False),
        sa.Column('embedding_dimension', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('student_id', name='uq_student_face_embeddings_student'),
        sa.CheckConstraint('embedding_dimension > 0', name='ck_student_face_embeddings_dimension'),
        sa.CheckConstraint('length(embedding) = embedding_dimension * 4', name='ck_student_face_embeddings_bytes'),
    )


def downgrade() -> None:
    op.drop_table('student_face_embeddings')
