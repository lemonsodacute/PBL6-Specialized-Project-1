import asyncio
from contextlib import asynccontextmanager, suppress
import logging

from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from app.core.database import SessionLocal
from app.core.config import settings
from app.services.student_card_previews import cleanup_previews
from app.services.student_card_ocr import OCRError, ocr

logger = logging.getLogger(__name__)


def cleanup_once():
    with SessionLocal() as db:
        return cleanup_previews(db)


async def cleanup_loop():
    while True:
        await asyncio.sleep(60)
        try:
            await run_in_threadpool(cleanup_once)
        except (SQLAlchemyError, OSError):
            # No paths, query parameters, OCR fields or images in logs.
            logger.warning('Student-card retention unavailable; retrying next interval')


@asynccontextmanager
async def identity_lifespan(_app):
    task = asyncio.create_task(cleanup_loop())
    async def warm_ocr():
        if not settings.STUDENT_CARD_OCR_AUTOSTART:
            return
        try:
            await run_in_threadpool(ocr.start)
        except OCRError:
            logger.warning('Local student-card OCR is unavailable; check offline provisioning')
    await warm_ocr()
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await run_in_threadpool(ocr.close)
