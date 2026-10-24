"""Private question attachments; document cleanup never touches this store."""
from pathlib import Path
from uuid import UUID
import shutil
import time

from app.services import question_document_drafts as documents
from app.services.question_document_extract import DocumentError

QUESTION_IMAGE_ROOT = Path(__file__).resolve().parents[2] / 'private' / 'question-images'


def attachment_path(question_id, image_id):
    return QUESTION_IMAGE_ROOT / str(UUID(str(question_id))) / (str(UUID(str(image_id))) + '.png')


def persist_images(session, drafts):
    """Called under session + bank locks before DB commit; UUIDs make retries stable."""
    by_id = {image['id']: image for image in session.get('images', [])}
    saved = {}
    for draft in drafts:
        attachments = []
        for image in draft.images:
            original = by_id.get(str(image.id))
            if original is None:
                raise DocumentError('INVALID_DRAFT', 'Hình ảnh không thuộc tài liệu đang review.')
            destination = attachment_path(draft.id, image.id)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(documents.source_image_path(session, image.id), destination)
            attachments.append({key: original.get(key) for key in ('id', 'page', 'position', 'mime_type', 'nearest_section', 'nearby_paragraph')} | {
                'source_document': session['filename'], 'source_question': original.get('question_number')})
        saved[draft.id] = attachments
    return saved


def rollback_images(drafts):
    for draft in drafts:
        folder = QUESTION_IMAGE_ROOT / str(draft.id)
        if folder.exists():
            if folder.resolve().parent != QUESTION_IMAGE_ROOT.resolve():
                raise OSError('Invalid attachment directory')
            shutil.rmtree(folder)


def cleanup_orphan_images(db=None):
    """Recover files copied before a process crash/DB rollback, after the 2h grace period."""
    if not QUESTION_IMAGE_ROOT.exists():
        return
    candidates = []
    for folder in QUESTION_IMAGE_ROOT.iterdir():
        if not folder.is_dir() or folder.is_symlink():
            continue
        try:
            question_id = UUID(folder.name)
            if time.time() - folder.stat().st_mtime >= documents.DOCUMENT_TTL.total_seconds():
                candidates.append((folder, question_id))
        except (ValueError, OSError):
            continue
    if not candidates:
        return
    from app.core.database import SessionLocal
    from app.models.entities import Question
    from sqlalchemy import select
    session = db or SessionLocal()
    try:
        for folder, question_id in candidates:
            if session.scalar(select(Question.id).where(Question.id == question_id)) is None:
                if folder.resolve().parent != QUESTION_IMAGE_ROOT.resolve():
                    continue
                shutil.rmtree(folder)
    finally:
        if db is None:
            session.close()
