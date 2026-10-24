"""Match PostgreSQL's separately-created cyclic FK in SQLite fixtures."""
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect


def install_avatar_foreign_key(connection):
    if connection.dialect.name != 'sqlite':
        return
    if any('avatar_reference_id' in row['constrained_columns'] for row in inspect(connection).get_foreign_keys('users')):
        return
    with Operations.context(MigrationContext.configure(connection)) as operations:
        with operations.batch_alter_table('users') as batch:
            batch.create_foreign_key('fk_user_card_avatar_reference', 'student_card_references', ['avatar_reference_id'], ['id'], ondelete='SET NULL')
