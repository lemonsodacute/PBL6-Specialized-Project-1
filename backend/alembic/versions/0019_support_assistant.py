"""Grounded support sessions in front of the existing human inbox."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '0019_support_assistant'
down_revision = '0018_support_chat'
branch_labels = depends_on = None


def upgrade():
    op.add_column('support_messages', sa.Column('kind', sa.String(20), nullable=False, server_default='message'))
    op.create_table('support_sessions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(10), nullable=False),
        sa.Column('category', sa.String(40)), sa.Column('topic', sa.String(80)),
        sa.Column('status', sa.String(20), nullable=False), sa.Column('phase', sa.String(20), nullable=False),
        sa.Column('conversation_id', UUID(as_uuid=True), sa.ForeignKey('support_conversations.id', ondelete='SET NULL')),
        sa.Column('summary', JSONB(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('resolved_at', sa.DateTime(timezone=True)), sa.Column('escalated_at', sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('AI_ACTIVE','RESOLVED_BY_AI','ESCALATED','ADMIN_ACTIVE','CLOSED')", name='ck_support_session_status'))
    op.create_index('idx_support_sessions_owner', 'support_sessions', ['user_id', 'created_at'])
    op.create_index('uq_support_session_active', 'support_sessions', ['user_id'], unique=True,
                    postgresql_where=sa.text("status IN ('AI_ACTIVE','ESCALATED','ADMIN_ACTIVE')"))
    op.create_table('support_turns',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('support_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('client_id', UUID(as_uuid=True), nullable=False), sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('action', sa.String(20), nullable=False), sa.Column('user_text', sa.Text(), nullable=False),
        sa.Column('assistant_text', sa.Text(), nullable=False), sa.Column('sources', JSONB(), nullable=False, server_default='[]'),
        sa.Column('used_provider', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('session_id', 'client_id', name='uq_support_turn_retry'))
    op.create_index('idx_support_turn_history', 'support_turns', ['session_id', 'created_at'])
    # Existing human conversations remain available; empty threads do not become cases.
    op.execute("""INSERT INTO support_sessions
      (id,user_id,role,category,status,phase,conversation_id,summary,created_at,updated_at,escalated_at)
      SELECT gen_random_uuid(), c.owner_id, u.role::text, 'other','ADMIN_ACTIVE','ESCALATE',c.id,
        '{"category": "Hỗ trợ trước khi nâng cấp", "issue": "Cuộc trò chuyện hỗ trợ đang có", "steps": [], "result": "Tiếp tục hỗ trợ bởi quản trị viên", "confirmed_unresolved": false}'::jsonb,
        c.created_at,c.updated_at,c.created_at
      FROM support_conversations c JOIN users u ON u.id=c.owner_id
      WHERE c.last_message_at IS NOT NULL AND u.role::text IN ('student','teacher')""")


def downgrade():
    op.drop_table('support_turns')
    op.drop_table('support_sessions')
    op.drop_column('support_messages', 'kind')
