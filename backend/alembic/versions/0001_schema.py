"""Create the official schema.sql schema.

schema.sql is the source of truth. Keeping this migration as a single execution
of that file prevents the migration from silently drifting from the checked-in
PostgreSQL schema.
"""
from pathlib import Path
from alembic import op

revision = '0001_schema'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    schema_path = Path(__file__).resolve().parents[3] / 'schema.sql'
    op.get_bind().exec_driver_sql(schema_path.read_text(encoding='utf-8'))

def downgrade() -> None:
    raise NotImplementedError('The official schema contains user data; create an explicit rollback migration before downgrading.')
