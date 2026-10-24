"""Periodic cleanup keeps abandoned question sources private and short-lived."""
import asyncio
from contextlib import asynccontextmanager, suppress

from starlette.concurrency import run_in_threadpool

from app.services.question_document_drafts import cleanup_expired
from app.services.question_images import cleanup_orphan_images
from sqlalchemy.exc import SQLAlchemyError


@asynccontextmanager
async def document_lifespan(_app):
    async def sweep():
        while True:
            # One inaccessible file must not stop future expiration checks.
            with suppress(OSError):
                await run_in_threadpool(cleanup_expired)
            with suppress(OSError, SQLAlchemyError):
                await run_in_threadpool(cleanup_orphan_images)
            await asyncio.sleep(60)

    task = asyncio.create_task(sweep())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
