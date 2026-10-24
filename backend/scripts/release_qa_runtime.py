"""Run release checks in a named, isolated PostgreSQL database.

No connection strings, passwords or JWTs are printed. Private runtime state is
kept under the already-ignored backend/private directory.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
STATE = BACKEND / 'private' / 'release-qa' / 'runtime.json'
PATTERN = r'ai_procto_release_qa_[0-9a-f]{16}'


def configuration():
    from app.core.config import settings
    from sqlalchemy.engine import make_url
    return make_url(settings.DATABASE_URL)


def state():
    data = json.loads(STATE.read_text(encoding='utf-8'))
    if not re.fullmatch(PATTERN, data['database_name']):
        raise RuntimeError('Unexpected QA database name')
    return data


def prepare():
    from sqlalchemy import create_engine, text
    url = configuration()
    if not url.drivername.startswith('postgresql'):
        raise RuntimeError('Release QA requires PostgreSQL')
    if STATE.exists():
        data = state()
        print(json.dumps({'qa_database': data['database_name'], 'reused': True}))
        return
    data = {'database_name': 'ai_procto_release_qa_' + uuid4().hex[:16], 'jwt_secret': secrets.token_urlsafe(48)}
    control = create_engine(url, isolation_level='AUTOCOMMIT')
    try:
        with control.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{data["database_name"]}"'))
    finally:
        control.dispose()
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(data), encoding='utf-8')
    print(json.dumps({'qa_database': data['database_name'], 'created': True}))


def run(command):
    data = state()
    environment = dict(os.environ)
    environment.update(DATABASE_URL=configuration().set(database=data['database_name']).render_as_string(hide_password=False),
                       JWT_SECRET=data['jwt_secret'], ENVIRONMENT='development', COOKIE_SECURE='false',
                       CORS_ORIGINS=json.dumps(['http://localhost:3000', 'http://localhost:3100']),
                       PYTHONIOENCODING='utf-8', STUDENT_CARD_OCR_AUTOSTART=os.environ.get('RELEASE_QA_OCR_AUTOSTART', 'false'))
    if command and command[0] == '--':
        command = command[1:]
    if not command:
        raise RuntimeError('Missing command')
    if command[0] == 'python':
        command[0] = sys.executable
    return subprocess.call(command, cwd=BACKEND, env=environment)


def probe():
    from sqlalchemy import create_engine, inspect, text
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    engine = create_engine(configuration())
    try:
        with engine.connect() as connection:
            heads = list(connection.scalars(text('SELECT version_num FROM alembic_version'))) if inspect(connection).has_table('alembic_version') else []
            tables = len(inspect(connection).get_table_names())
        config = Config(str(BACKEND / 'alembic.ini'))
        config.set_main_option('script_location', str(BACKEND / 'alembic'))
        expected = ScriptDirectory.from_config(config).get_heads()
        print(json.dumps({'configured_db_connected': True, 'configured_db_heads': heads, 'expected_heads': expected,
                          'configured_db_at_head': sorted(heads) == sorted(expected), 'tables': tables}))
    finally:
        engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'probe', 'run'])
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.action == 'prepare': prepare()
        elif args.action == 'probe': probe()
        else: raise SystemExit(run(args.command))
    except Exception as error:
        print(json.dumps({'error_type': type(error).__name__, 'message': 'QA runtime failed; connection credentials withheld.'}))
        raise SystemExit(1) from None
