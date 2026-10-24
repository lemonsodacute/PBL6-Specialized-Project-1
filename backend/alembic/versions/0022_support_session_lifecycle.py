"""Explicit session closure, retry-safe starts and separate human threads."""
from collections import defaultdict
from uuid import uuid4
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0022_support_session_lifecycle'
down_revision = '0021_draft_quality_rating'
branch_labels = depends_on = None


def upgrade():
    op.add_column('support_sessions', sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('support_sessions', sa.Column('closed_by', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_support_session_closed_by', 'support_sessions', 'users', ['closed_by'], ['id'], ondelete='SET NULL')
    op.add_column('support_sessions', sa.Column('start_key', UUID(as_uuid=True), nullable=True))
    op.create_unique_constraint('uq_support_session_start_retry', 'support_sessions', ['user_id', 'start_key'])
    connection = op.get_bind()
    for constraint in sa.inspect(connection).get_unique_constraints('support_conversations'):
        if constraint['column_names'] == ['owner_id']:
            op.drop_constraint(constraint['name'], 'support_conversations', type_='unique')
    op.create_index('ix_support_conversations_owner_id', 'support_conversations', ['owner_id'])
    connection.execute(sa.text("UPDATE support_sessions SET closed_at=COALESCE(resolved_at,updated_at) WHERE status='CLOSED'"))
    # Legacy versions reused one human thread across sessions. Partition its
    # existing messages/notifications at escalation boundaries, retaining IDs,
    # read watermarks and all content, before allowing fresh independent threads.
    groups = defaultdict(list)
    for row in connection.execute(sa.text('''SELECT id,user_id,conversation_id,created_at,updated_at,
            COALESCE(escalated_at,created_at) AS boundary FROM support_sessions
            WHERE conversation_id IS NOT NULL ORDER BY COALESCE(escalated_at,created_at),created_at,id''')).mappings():
        groups[row['conversation_id']].append(row)
    for original, sessions in groups.items():
        if len(sessions) < 2:
            continue
        for index, session in enumerate(sessions):
            target = original if index == 0 else uuid4()
            if index:
                connection.execute(sa.text('''INSERT INTO support_conversations (id,owner_id,created_at,updated_at)
                    VALUES (:id,:owner,:created,:updated)'''), {'id': target, 'owner': session['user_id'], 'created': session['created_at'], 'updated': session['updated_at']})
                end = sessions[index + 1]['boundary'] if index + 1 < len(sessions) else None
                for table in ('support_messages', 'notifications'):
                    column = 'conversation_id' if table == 'support_messages' else 'related_conversation_id'
                    connection.execute(sa.text(f'''UPDATE {table} SET {column}=:target WHERE {column}=:original
                        AND created_at>=:start AND (:finish IS NULL OR created_at<:finish)'''),
                        {'target': target, 'original': original, 'start': session['boundary'], 'finish': end})
                connection.execute(sa.text('UPDATE support_sessions SET conversation_id=:target WHERE id=:session'), {'target': target, 'session': session['id']})
            connection.execute(sa.text('''UPDATE support_conversations SET last_message_at=
                (SELECT max(created_at) FROM support_messages WHERE conversation_id=:target) WHERE id=:target'''), {'target': target})
        connection.execute(sa.text('''UPDATE support_conversations SET last_message_at=
            (SELECT max(created_at) FROM support_messages WHERE conversation_id=:target) WHERE id=:target'''), {'target': original})


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT count(*) FROM (SELECT owner_id FROM support_conversations GROUP BY owner_id HAVING count(*)>1) AS shared')):
        raise RuntimeError('Multiple support histories exist; consolidate them explicitly before downgrading to preserve messages.')
    op.drop_index('ix_support_conversations_owner_id', table_name='support_conversations')
    op.create_unique_constraint('support_conversations_owner_id_key', 'support_conversations', ['owner_id'])
    op.drop_constraint('uq_support_session_start_retry', 'support_sessions', type_='unique')
    op.drop_constraint('fk_support_session_closed_by', 'support_sessions', type_='foreignkey')
    for column in ('start_key', 'closed_by', 'closed_at'):
        op.drop_column('support_sessions', column)
