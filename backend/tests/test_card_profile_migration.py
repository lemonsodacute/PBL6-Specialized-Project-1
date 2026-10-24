import os
from pathlib import Path
from unittest import TestCase, skipUnless

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.core.config import settings


@skipUnless(os.environ.get('CARD_PROFILE_TEST_POSTGRES') == '1', 'Opt-in PostgreSQL migration using temporary users table only')
class CardProfileMigrationTests(TestCase):
    def test_nullable_class_and_name_approval_before_id_preserve_existing_user_data(self):
        engine = create_engine(settings.DATABASE_URL)
        self.addCleanup(engine.dispose)
        config = Config(str(Path(__file__).resolve().parents[1]/'alembic.ini'))
        config.set_main_option('script_location', str(Path(__file__).resolve().parents[1]/'alembic'))
        migration = ScriptDirectory.from_config(config).get_revision('0017_card_profile_metadata').module
        with engine.begin() as connection:
            connection.execute(text('SET LOCAL search_path TO pg_temp'))
            connection.execute(text("""CREATE TEMP TABLE users (id integer PRIMARY KEY, full_name text NOT NULL,
                role text NOT NULL, student_code text, identity_profile_status text NOT NULL, identity_verified_at timestamptz,
                CONSTRAINT ck_users_verified_identity CHECK (identity_profile_status != 'VERIFIED' OR
                (role='student' AND student_code IS NOT NULL AND length(trim(full_name))>0 AND identity_verified_at IS NOT NULL))) ON COMMIT DROP"""))
            connection.execute(text("INSERT INTO users VALUES (1, 'Synthetic student', 'student', NULL, 'PENDING', NULL)"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            connection.execute(text("UPDATE users SET identity_profile_status='VERIFIED', identity_verified_at=now() WHERE id=1"))
            row = connection.execute(text('SELECT * FROM users WHERE id=1')).mappings().one()
            self.assertEqual(row['full_name'], 'Synthetic student')
            self.assertIsNone(row['student_code']); self.assertIsNone(row['class_name'])
            with Operations.context(MigrationContext.configure(connection)):
                with self.assertRaisesRegex(RuntimeError, 'must be completed'):
                    migration.downgrade()
            connection.execute(text("UPDATE users SET student_code='102230057', class_name='22T1' WHERE id=1"))
            self.assertEqual(connection.scalar(text('SELECT class_name FROM users WHERE id=1')), '22T1')
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            row = connection.execute(text('SELECT * FROM users WHERE id=1')).mappings().one()
            self.assertEqual(row['student_code'], '102230057')
            self.assertNotIn('class_name', row)
