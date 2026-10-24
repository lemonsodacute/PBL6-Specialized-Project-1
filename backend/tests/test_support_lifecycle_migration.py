"""PostgreSQL migration on temporary tables only; preserve message/read IDs."""
import os
from pathlib import Path
from unittest import TestCase, skipUnless
from uuid import uuid4
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from app.core.config import settings


@skipUnless(os.environ.get('SUPPORT_LIFECYCLE_TEST_POSTGRES') == '1', 'Opt-in temporary-table PostgreSQL migration test')
class SupportLifecycleMigrationTests(TestCase):
    def test_split_legacy_threads_preserves_messages_notifications_read_state_and_closed_metadata(self):
        engine = create_engine(settings.DATABASE_URL); self.addCleanup(engine.dispose)
        config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
        config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'alembic'))
        migration = ScriptDirectory.from_config(config).get_revision('0022_support_session_lifecycle').module
        owner, conversation, old, current, first_msg, second_msg = [uuid4() for _ in range(6)]
        params = dict(owner=owner, conversation=conversation, old=old, current=current, first=first_msg, second=second_msg)
        with engine.begin() as connection:
            connection.execute(text('SET LOCAL search_path TO pg_temp'))
            for ddl in (
                'CREATE TEMP TABLE users (id uuid PRIMARY KEY) ON COMMIT DROP',
                'CREATE TEMP TABLE support_conversations (id uuid PRIMARY KEY, owner_id uuid UNIQUE NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, last_message_at timestamptz) ON COMMIT DROP',
                'CREATE TEMP TABLE support_sessions (id uuid PRIMARY KEY,user_id uuid NOT NULL,conversation_id uuid,status text,created_at timestamptz,updated_at timestamptz,resolved_at timestamptz,escalated_at timestamptz) ON COMMIT DROP',
                'CREATE TEMP TABLE support_messages (id uuid PRIMARY KEY,conversation_id uuid,body text,created_at timestamptz,read_at timestamptz) ON COMMIT DROP',
                'CREATE TEMP TABLE notifications (id uuid PRIMARY KEY,related_conversation_id uuid,created_at timestamptz,is_read boolean) ON COMMIT DROP'):
                connection.execute(text(ddl))
            connection.execute(text('INSERT INTO users VALUES (:owner)'), params)
            connection.execute(text("INSERT INTO support_conversations VALUES (:conversation,:owner,'2026-10-01','2026-10-03','2026-10-03')"), params)
            connection.execute(text("INSERT INTO support_sessions VALUES (:old,:owner,:conversation,'CLOSED','2026-10-01','2026-10-02','2026-10-02','2026-10-01'),(:current,:owner,:conversation,'ADMIN_ACTIVE','2026-10-03','2026-10-03',NULL,'2026-10-03')"), params)
            connection.execute(text("INSERT INTO support_messages VALUES (:first,:conversation,'old message','2026-10-01','2026-10-02'),(:second,:conversation,'unseen reply','2026-10-03',NULL)"), params)
            connection.execute(text("INSERT INTO notifications VALUES (:first,:conversation,'2026-10-01',true),(:second,:conversation,'2026-10-03',false)"), params)
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            sessions = {row['id']: row for row in connection.execute(text('SELECT * FROM support_sessions')).mappings()}
            self.assertIsNotNone(sessions[old]['closed_at']); self.assertIsNone(sessions[old]['closed_by'])
            self.assertEqual(sessions[old]['conversation_id'], conversation)
            self.assertNotEqual(sessions[current]['conversation_id'], conversation)
            messages = {row['id']: row for row in connection.execute(text('SELECT * FROM support_messages')).mappings()}
            self.assertEqual(set(messages), {first_msg, second_msg})
            self.assertEqual(messages[first_msg]['conversation_id'], conversation)
            self.assertEqual(messages[second_msg]['conversation_id'], sessions[current]['conversation_id'])
            self.assertIsNotNone(messages[first_msg]['read_at']); self.assertIsNone(messages[second_msg]['read_at'])
            notices = {row['id']: row for row in connection.execute(text('SELECT * FROM notifications')).mappings()}
            self.assertFalse(notices[second_msg]['is_read'])
            self.assertEqual(notices[second_msg]['related_conversation_id'], messages[second_msg]['conversation_id'])
            self.assertEqual(connection.scalar(text('SELECT count(*) FROM support_conversations')), 2)
            with Operations.context(MigrationContext.configure(connection)):
                with self.assertRaisesRegex(RuntimeError, 'preserve messages'):
                    migration.downgrade()
