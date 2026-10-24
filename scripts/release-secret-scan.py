"""Redacted release scan of first-party source and browser production chunks.

Heuristic plus exact comparison against locally configured server credentials;
this is not a claim about version-control history or third-party dependencies.
"""
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.core.config import settings
from sqlalchemy.engine import make_url

values = [settings.JWT_SECRET, settings.QUESTION_GENERATION_API_KEY, settings.LIVEKIT_API_SECRET,
          make_url(settings.DATABASE_URL).password or '']
values = [v for v in values if len(v) >= 8 and v.lower() not in {'change-me', 'postgres', 'password'}]
patterns = [re.compile(r'AIza[0-9A-Za-z_-]{30,}'), re.compile(r'sk-(?:proj-)?[A-Za-z0-9_-]{30,}'),
            re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
skip = {'node_modules', 'private', 'uploads', 'models', 'data', 'datasets', 'artifacts', '__pycache__', '.git', 'test-results'}
suffixes = {'.py', '.ts', '.tsx', '.js', '.cjs', '.mjs', '.css', '.json', '.md', '.ini', '.sql', '.ps1', '.txt', '.yaml', '.yml'}
files = [p for base in (ROOT, ROOT / 'backend') for p in base.iterdir()
         if p.is_file() and ((p.suffix in suffixes and not p.name.startswith('.env')) or p.name == '.env.example')]
for source in ('app', 'components', 'lib', 'types', 'mock', 'tests', 'docs', 'scripts', 'infra',
               'backend/app', 'backend/alembic', 'backend/scripts', 'backend/tests'):
    for directory, dirs, names in os.walk(ROOT / source):
        dirs[:] = [d for d in dirs if d not in skip and not d.startswith(('.venv', '.next', '.codex'))]
        for name in names:
            p = Path(directory, name)
            if p.suffix in suffixes and not name.startswith('.env'):
                files.append(p)
bundle = ROOT / '.next' / 'static'
if bundle.exists():
    files.extend(p for p in bundle.rglob('*') if p.suffix in {'.js', '.css', '.json', '.map'})
findings = []
for p in files:
    # Resolve once per file; per-line filesystem lookups are prohibitively slow
    # on Windows and provide no additional security.
    if p.resolve() == Path(__file__).resolve():
        continue
    content = p.read_text(encoding='utf-8', errors='replace')
    for number, line in enumerate(content.splitlines(), 1):
        for value in values:
            if value in line:
                findings.append({'path': p.relative_to(ROOT).as_posix(), 'line': number, 'kind': 'configured_secret_literal'})
                break
        else:
            if any(pattern.search(line) for pattern in patterns):
                findings.append({'path': p.relative_to(ROOT).as_posix(), 'line': number, 'kind': 'secret_pattern'})
print(json.dumps({'scanned_files': len(files), 'production_chunks_scanned': bundle.exists(), 'findings': findings}, indent=2))
sys.exit(bool(findings))
