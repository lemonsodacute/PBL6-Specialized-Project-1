"""Store student identity enrollment images pending face model integration."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0005_student_identities'
down_revision = '0004_notifications'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # The checked-in initial schema already contains this historical table.
    if sa.inspect(op.get_bind()).has_table('student_identities'):
        return
    op.create_table(
        'student_identities',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('front_image_path', sa.Text()), sa.Column('left_image_path', sa.Text()), sa.Column('right_image_path', sa.Text()),
        sa.Column('status', sa.String(40), nullable=False, server_default=sa.text("'pending_model'")),
        sa.Column('consented_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('student_id'),
    )
    op.create_index('idx_student_identities_student', 'student_identities', ['student_id'])

def downgrade() -> None:
    op.drop_index('idx_student_identities_student', table_name='student_identities')
    op.drop_table('student_identities')
