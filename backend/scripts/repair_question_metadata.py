"""Preview/fix previously imported exam-question metadata.

No arguments other than --bank-id: strictly read-only. --apply requires an
explicit bank ID and writes a local JSON backup BEFORE any database changes.
Does not change exam-question point allocations, answer keys or question types.
"""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import sys
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from app.core.database import SessionLocal
from app.models.entities import Question
from app.services.question_document_drafts import strip_presentation_metadata


def repair_candidates(db, bank_id):
    rows = list(db.scalars(select(Question).where(Question.question_bank_id == bank_id).order_by(Question.id)))
    proposals = []
    existing = {row.content.strip().casefold(): row.id for row in rows}
    for row in rows:
        cleaned, points, hint = strip_presentation_metadata(row.content)
        if not cleaned or (cleaned == row.content and points is None):
            continue
        if points is not None and not Decimal('0') < points <= Decimal('9999.99'):
            continue
        if existing.get(cleaned.casefold(), row.id) != row.id:
            print(f'SKIP duplicate content for question {row.id}')
            continue
        proposals.append({
            'id': str(row.id), 'question_bank_id': str(row.question_bank_id),
            'content_before': row.content, 'content_after': cleaned,
            'points_before': str(row.default_points),
            'points_after': str(points if points is not None else row.default_points),
            'choice_hint': hint, 'stored_type': row.type.value,
        })
    return proposals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bank-id', required=True, type=UUID, help='Restrict repair to one known question bank')
    parser.add_argument('--apply', action='store_true', help='Commit the reviewed changes (default: preview only)')
    args = parser.parse_args()

    with SessionLocal() as db:
        proposals = repair_candidates(db, args.bank_id)
        print(json.dumps({'bank_id': str(args.bank_id), 'dry_run': not args.apply,
                          'candidate_count': len(proposals),
                          'candidates': [{key: value for key, value in item.items()
                                          if key in ('id','points_before','points_after','choice_hint','stored_type')}
                                         for item in proposals]}, ensure_ascii=False, indent=2))
        if not args.apply or not proposals:
            return
        # Backups live under backend/private and are never served by public routes.
        backup_dir = Path(__file__).resolve().parents[1] / 'private' / 'question-metadata-repairs'
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup_path = backup_dir / f'{args.bank_id}-{stamp}.json'
        with backup_path.open('x', encoding='utf-8') as stream:
            json.dump(proposals, stream, ensure_ascii=False, indent=2)
        by_id = {item['id']: item for item in proposals}
        # Re-check row content in the same database transaction to avoid applying stale repair.
        for row in db.scalars(select(Question).where(Question.question_bank_id == args.bank_id).with_for_update()):
            item = by_id.get(str(row.id))
            if not item:
                continue
            if row.content != item['content_before'] or str(row.default_points) != item['points_before']:
                raise RuntimeError(f'Question {row.id} changed; rollback and retry.')
            row.content = item['content_after']
            row.default_points = Decimal(item['points_after'])
            # Do not modify row.type or an existing exam_question.points automatically.
        db.commit()
        print(f'Updated {len(proposals)} questions. Backup: {backup_path}')


if __name__ == '__main__':
    main()
