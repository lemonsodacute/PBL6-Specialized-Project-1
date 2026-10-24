"""Read-only DEV diagnostics; no prompts, credentials, URLs or provider replies."""
from fastapi import APIRouter, Depends, HTTPException, Response
from app.api.deps import roles
from app.api.responses import ok
from app.core.config import get_settings
from app.models.entities import User, UserRole
from app.services.ai_provider import provider_diagnostics

router = APIRouter()


@router.get('/admin/ai-provider/diagnostics')
def diagnostics(response: Response, user: User = Depends(roles(UserRole.admin))):
    settings = get_settings()
    if settings.ENVIRONMENT.lower() not in {'development', 'dev', 'local', 'test'}:
        raise HTTPException(404, 'Not found')
    response.headers['Cache-Control'] = 'no-store'
    return ok(provider_diagnostics(settings))
