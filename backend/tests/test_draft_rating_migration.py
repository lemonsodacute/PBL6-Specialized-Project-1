"""Exercise PostgreSQL DDL on a temporary table, preserving application data."""
import os
from pathlib import Path
from unittest import TestCase, skipUnless
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from app.core.config import settings


@skipUnless(os.environ.get('QUALITY_RATING_TEST_POSTGRES') == '1', 'Opt-in PostgreSQL temporary-table migration test')
class DraftRatingMigrationTests(TestCase):
    def test_nullable_rating_upgrade_range_constraint_and_downgrade_preserve_legacy_feedback(self):
        engine = create_engine(settings.DATABASE_URL)
        self.addCleanup(engine.dispose)
        config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
        config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'alembic'))
        migration = ScriptDirectory.from_config(config).get_revision('0021_draft_quality_rating').module
        with engine.begin() as connection:
            connection.execute(text('SET LOCAL search_path TO pg_temp'))
            connection.execute(text('CREATE TEMP TABLE ai_draft_reviews (id integer PRIMARY KEY, decision text, reason text) ON COMMIT DROP'))
            connection.execute(text("INSERT INTO ai_draft_reviews VALUES (1, 'accepted', 'ambiguous')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            row = connection.execute(text('SELECT * FROM ai_draft_reviews')).mappings().one()
            self.assertIsNone(row['quality_rating']); self.assertIsNone(row['reason_note'])
            self.assertEqual(row['decision'], 'accepted'); self.assertEqual(row['reason'], 'ambiguous')
            for invalid in (0, 6):
                with self.assertRaises(IntegrityError):
                    with connection.begin_nested():
                        connection.execute(text('UPDATE ai_draft_reviews SET quality_rating=:rating'), {'rating': invalid})
            for valid in (1, 5, None):
                connection.execute(text('UPDATE ai_draft_reviews SET quality_rating=:rating'), {'rating': valid})
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            row = connection.execute(text('SELECT * FROM ai_draft_reviews')).mappings().one()
            self.assertEqual(dict(row), {'id': 1, 'decision': 'accepted', 'reason': 'ambiguous'})
