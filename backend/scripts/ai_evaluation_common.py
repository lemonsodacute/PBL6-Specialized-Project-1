"""Evaluation-only helpers. Application data is read under a read-only transaction."""
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / 'artifacts' / 'ai-evaluation'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     default=str).encode('utf-8')).hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf-8')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def require_legacy_evaluation_schema(dataset):
    """Do not silently score unreviewed/manual golden facts with the old rubric."""
    if dataset.get('review_status') == 'NEEDS_HUMAN_REVIEW' or any(
            c.get('review_status') == 'NEEDS_HUMAN_REVIEW' for c in dataset.get('cases', [])):
        raise ValueError('Golden set needs human review; no provider calls or scores are allowed yet.')
    if dataset.get('schema_version', 1) != 1:
        raise ValueError('Manual golden schema requires a reviewed rubric and explicit bank scopes; legacy scorer accepts schema 1 only.')


def write_csv(path, rows):
    if not rows:
        return
    with Path(path).open('w', encoding='utf-8-sig', newline='') as target:
        writer = csv.DictWriter(target, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v
                         for k, v in row.items()} for row in rows)


def latency_summary(values):
    values = sorted(values)
    return {'samples': len(values), 'average_ms': sum(values) / len(values) if values else None,
            'p95_ms': values[math.ceil(.95 * len(values)) - 1] if values else None,
            'p95_method': 'nearest rank: sorted[ceil(0.95*n)-1]'}


def provenance(files):
    return {'git_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'source_sha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
            'created_at_utc': datetime.now(timezone.utc).isoformat(),
            'application_changes': 'None made by these evaluation scripts; working tree may contain pre-existing changes.'}


def readonly_session():
    from app.core.database import SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    if db.bind.dialect.name != 'postgresql':
        db.close()
        raise RuntimeError('Snapshot collection requires PostgreSQL read-only transaction protection.')
    db.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
    return db


def collect_snapshot(db):
    from sqlalchemy import select, func
    from app.models.entities import Question, QuestionBank
    from app.services import support_knowledge as kb
    from app.services.question_types import SUPPORTED_QUESTION_TYPES
    banks = db.scalars(select(QuestionBank).where(QuestionBank.is_active.is_(True)).order_by(QuestionBank.id)).all()
    questions = db.scalars(select(Question).where(Question.question_bank_id.in_([b.id for b in banks]),
        Question.type.in_(SUPPORTED_QUESTION_TYPES)).order_by(Question.id)).all()
    # No account IDs, answers, grades, chat histories, biometric or provider secrets.
    corpus = {'articles': sorted(kb.articles(db), key=lambda a: a['id']),
              'banks': [dict(id=str(b.id), name=b.name, subject=b.subject) for b in banks],
              'questions': [dict(id=str(q.id), bank_id=str(q.question_bank_id), content=q.content,
                  topic=q.topic, type=q.type.value, is_active=q.is_active, created_at=q.created_at.isoformat())
                  for q in questions]}
    return {'schema_version': 1, 'collected_at_utc': datetime.now(timezone.utc).isoformat(),
            'database_dialect': db.bind.dialect.name, 'read_only': True,
            'total_database_questions': db.scalar(select(func.count()).select_from(Question)),
            'scope': 'Active banks, supported question types; inactive questions remain visible as in default list endpoint.',
            'corpus_sha256': digest(corpus), 'corpus': corpus}


def snapshot(output, db=None, refresh=False):
    path = Path(output) / 'corpus-snapshot.json'
    if path.exists() and not refresh:
        result = read_json(path)
        if digest(result['corpus']) != result['corpus_sha256']:
            raise ValueError('Snapshot checksum mismatch.')
        return result
    if db is None:
        with readonly_session() as connection:
            result = collect_snapshot(connection)
    else:
        result = collect_snapshot(db)
    write_json(path, result)
    return result


def retrieval_metrics(returned, relevance):
    """Binary relevance; precision denominator is K even for short result lists."""
    if len(returned) != len(set(returned)):
        raise ValueError('Duplicate returned IDs would inflate retrieval scores.')
    if any(not isinstance(g, int) or g < 0 for g in relevance.values()):
        raise ValueError('Relevance grades must be non-negative integers.')
    relevant = {qid for qid, grade in relevance.items() if grade > 0}
    result = {}
    for k in (1, 3, 5):
        hits = sum(qid in relevant for qid in returned[:k])
        result[f'precision_at_{k}'] = hits / k
        result[f'hit_rate_at_{k}'] = int(hits > 0)
    result['recall_at_5'] = sum(q in relevant for q in returned[:5]) / len(relevant) if relevant else None
    first = next((rank for rank, qid in enumerate(returned, 1) if qid in relevant), None)
    result['first_relevant_rank'] = first
    result['reciprocal_rank'] = 1 / first if first else 0
    dcg = sum((2 ** relevance.get(qid, 0) - 1) / math.log2(rank + 1)
              for rank, qid in enumerate(returned[:5], 1))
    ideal = sum((2 ** grade - 1) / math.log2(rank + 1)
                for rank, grade in enumerate(sorted(relevance.values(), reverse=True)[:5], 1))
    result['ndcg_at_5'] = dcg / ideal if ideal else None
    return result


def mean_metrics(rows, keys):
    return {key: sum(r[key] for r in rows if r[key] is not None) /
            sum(r[key] is not None for r in rows) if any(r[key] is not None for r in rows) else None for key in keys}
