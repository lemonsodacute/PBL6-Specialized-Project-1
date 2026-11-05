"""Temporary, opt-in pipeline diagnostics. Callers pass counts/statuses, never identities or media."""
import json
import logging
from app.core.config import settings

logger = logging.getLogger('proctor.pipeline')
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(logging.StreamHandler())


def diagnostic(stage, *, trace=None, **fields):
    if settings.PROCTOR_DIAGNOSTICS:
        logger.info('proctor_pipeline %s', json.dumps({'stage': stage, 'trace': trace, **fields}, separators=(',', ':')))
