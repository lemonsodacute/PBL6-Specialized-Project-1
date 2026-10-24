"""Persistent support inbox, shared admin read state and notification links."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0018_support_chat'
down_revision = '0017_card_profile_metadata'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'support_message'")
    op.create_table('support_conversations',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('last_message_at', sa.DateTime(timezone=True)))
    op.create_index('idx_support_conversations_activity', 'support_conversations', ['last_message_at', 'id'])
    op.create_table('support_messages',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('conversation_id', UUID(as_uuid=True), sa.ForeignKey('support_conversations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sender_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('client_id', UUID(as_uuid=True), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('conversation_id', 'sender_id', 'client_id', name='uq_support_message_retry'),
        sa.CheckConstraint('length(trim(body)) BETWEEN 1 AND 4000', name='ck_support_message_body'))
    op.create_index('idx_support_messages_history', 'support_messages', ['conversation_id', 'created_at', 'id'])
    op.create_index('idx_support_messages_unread', 'support_messages', ['conversation_id', 'read_at', 'sender_id'])
    op.add_column('notifications', sa.Column('related_conversation_id', UUID(as_uuid=True), sa.ForeignKey('support_conversations.id', ondelete='CASCADE')))


def downgrade():
    op.drop_column('notifications', 'related_conversation_id')
    op.drop_table('support_messages')
    op.drop_table('support_conversations')
    # Keep the unused enum value: PostgreSQL cannot safely remove enum labels.
