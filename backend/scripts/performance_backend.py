"""Run the current or captured original backend for an isolated local QA comparison."""
from pathlib import Path
import os
import re
import sys
import zipfile
from sqlalchemy.engine import make_url

try:
    qa_database = make_url(os.environ.get('DATABASE_URL', '')).database
except Exception:
    raise SystemExit('Use the isolated release QA runtime') from None
if not re.fullmatch(r'ai_procto_release_qa_[0-9a-f]{16}', qa_database or ''):
    raise SystemExit('Use the isolated release QA runtime')

root = Path(__file__).resolve().parents[2]
snapshot = root / 'artifacts' / 'performance' / 'before-backend'
if '--snapshot' in sys.argv:
    snapshot.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(root / 'artifacts/performance/before-source.zip') as archive:
        for name in archive.namelist():
            if not name.startswith('backend/app/'):
                continue
            target = (snapshot / name.removeprefix('backend/')).resolve()
            if not target.is_relative_to(snapshot.resolve()):
                raise RuntimeError('Invalid snapshot path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
    (snapshot / 'app/core/performance.py').write_bytes((root / 'backend/app/core/performance.py').read_bytes())
    main = snapshot / 'app/main.py'
    main.write_text(main.read_text('utf-8') + '\nfrom app.core.database import engine\nfrom app.core.performance import install_request_timing\ninstall_request_timing(app, engine, enabled=True)\n', encoding='utf-8')
    sys.path.insert(0, str(snapshot))

import uvicorn
uvicorn.run('app.main:app', host='127.0.0.1', port=8001, access_log=False)
