"""Validate/adopt legacy schemas without editing historical migrations.

python -m scripts.migrate_identity          # read-only target audit
python -m scripts.migrate_identity --apply # checked baseline + Alembic upgrade

Requires CREATEDB for a disposable reference database. No images or user rows
are read or written. Unknown schema drift fails closed, before target DDL.
"""
import argparse
from contextlib import contextmanager
from pathlib import Path
import re
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.core.config import settings

BACKEND = Path(__file__).resolve().parents[1]
BASELINE = '0006_identity_verifications'
OPTIONAL_MISSING = {'notifications': '0004_notifications', 'identity_verifications': BASELINE}


def config():
    result = Config(str(BACKEND / 'alembic.ini'))
    result.set_main_option('script_location', str(BACKEND / 'alembic'))
    return result


def snapshot(connection):
    inspector = inspect(connection)
    tables = {}
    for table in sorted(inspector.get_table_names()):
        if table == 'alembic_version':
            continue
        tables[table] = {
            'columns': {col['name']: {'type': col['type'].compile(dialect=connection.dialect), 'nullable': col['nullable'], 'default': col['default']} for col in inspector.get_columns(table)},
            'pk': inspector.get_pk_constraint(table)['constrained_columns'],
            'unique': sorted([sorted(item['column_names']) for item in inspector.get_unique_constraints(table)]),
            'fk': sorted([{k: v for k, v in item.items() if k != 'name'} for item in inspector.get_foreign_keys(table)], key=str),
            'checks': sorted([item['sqltext'] for item in inspector.get_check_constraints(table)]),
            'indexes': sorted([{k: v for k, v in item.items() if k in ('name', 'column_names', 'unique', 'expressions', 'dialect_options')} for item in inspector.get_indexes(table)], key=str),
        }
    enums = {item['name']: item['labels'] for item in inspector.get_enums()}
    triggers = connection.execute(text("SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY c.relname,t.tgname")).all()
    functions = connection.execute(text("SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('set_updated_at', 'increment_violation_count') ORDER BY p.proname")).all()
    return {'tables': tables, 'enums': enums, 'triggers': [tuple(row) for row in triggers], 'functions': [(row[0], row[1].replace('\r\n', '\n')) for row in functions]}


@contextmanager
def reference_database(target_url):
    name = f'ai_procto_identity_probe_{uuid4().hex}'
    control = create_engine(target_url, isolation_level='AUTOCOMMIT')
    with control.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(control.url.set(database=name))
    try:
        cfg = config()
        with patch.object(settings, 'DATABASE_URL', engine.url.render_as_string(hide_password=False)):
            command.upgrade(cfg, '0004_notifications')
            scripts = ScriptDirectory.from_config(cfg)
            # Prove the tables embedded in schema.sql equal the frozen 0005/6
            # migrations, by rebuilding EMPTY tables only in our disposable DB.
            for revision, table in (('0005_student_identities', 'student_identities'), (BASELINE, 'identity_verifications')):
                with engine.connect() as connection:
                    before = snapshot(connection)['tables'][table]
                module = scripts.get_revision(revision).module
                with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
                    module.downgrade()
                    module.upgrade()
                with engine.connect() as connection:
                    if before != snapshot(connection)['tables'][table]:
                        raise RuntimeError(f'Historical schema mismatch for {table}; cannot adopt baseline')
            command.stamp(cfg, BASELINE)
        with engine.connect() as connection:
            yield snapshot(connection)
    finally:
        engine.dispose()
        if not re.fullmatch(r'ai_procto_identity_probe_[0-9a-f]{32}', name):
            raise RuntimeError('Unexpected reference database name')
        with control.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{name}"'))
        control.dispose()


def check_legacy(actual, expected):
    missing = set(expected['tables']) - set(actual['tables'])
    extra = set(actual['tables']) - set(expected['tables'])
    changed = {name for name in set(actual['tables']) & set(expected['tables']) if actual['tables'][name] != expected['tables'][name]}
    enum_expected = dict(expected['enums'])
    if 'notifications' in missing and 'notification_type' not in actual['enums']:
        enum_expected.pop('notification_type', None)
    if extra or changed or missing - OPTIONAL_MISSING.keys() or actual['enums'] != enum_expected or actual['triggers'] != expected['triggers'] or actual['functions'] != expected['functions']:
        raise RuntimeError(f'Unrecognized schema drift: missing={sorted(missing)}, extra={sorted(extra)}, changed={sorted(changed)}; enums/triggers/functions must also match')
    return sorted(missing)


def migrate(apply=False):
    engine = create_engine(settings.DATABASE_URL)
    try:
        with engine.connect() as connection:
            versioned = inspect(connection).has_table('alembic_version')
            revisions = connection.execute(text('select version_num from alembic_version')).scalars().all() if versioned else []
            empty = not inspect(connection).get_table_names()
        if revisions:
            # Existing managed databases keep the normal Alembic path. A 0004
            # database containing 0005/6 tables still needs explicit adoption.
            if revisions != ['0004_notifications']:
                if apply:
                    command.upgrade(config(), 'head')
                return {'managed_revisions': revisions, 'action': 'upgrade head', 'applied': apply}
        with reference_database(settings.DATABASE_URL) as expected:
            with engine.begin() as connection:
                connection.execute(text('SELECT pg_advisory_xact_lock(81926006)'))
                cfg = config()
                cfg.attributes['connection'] = connection
                if empty:
                    if not apply:
                        return {'action': 'initialize checked baseline then upgrade head', 'applied': False}
                    command.upgrade(cfg, '0004_notifications')
                missing = check_legacy(snapshot(connection), expected)
                if not apply:
                    return {'action': 'adopt checked baseline then upgrade head', 'missing_tables': missing, 'applied': False}
                scripts = ScriptDirectory.from_config(cfg)
                with Operations.context(MigrationContext.configure(connection)):
                    for table in missing:
                        scripts.get_revision(OPTIONAL_MISSING[table]).module.upgrade()
                if snapshot(connection) != expected:
                    raise RuntimeError('Schema differs after applying missing historical migrations; rolling back')
                command.stamp(cfg, BASELINE)
                command.upgrade(cfg, 'head')
                return {'action': 'adopted checked baseline and upgraded head', 'applied': True}
    finally:
        engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    arguments = parser.parse_args()
    print(migrate(arguments.apply))
