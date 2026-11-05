from pathlib import Path
from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.api.v1.router import router
from app.api.media import router as private_media_router
from app.core.config import get_settings
from app.core.database import engine
from app.core.performance import install_request_timing
from app.core.proctor_limits import ProctorBodyLimit
from app.services.student_card_retention import identity_lifespan
from app.services.question_document_retention import document_lifespan
from app.services.classroom_lifecycle import classroom_lifespan
from app.services.support_realtime import support_lifespan
from app.services.proctor_realtime import proctor_lifespan
from app.services import proctor_lifecycle  # Register commit-only status invalidations.
settings=get_settings()
logging.getLogger('app.audit').setLevel(logging.INFO)
@asynccontextmanager
async def application_lifespan(application):
    async with identity_lifespan(application), document_lifespan(application), classroom_lifespan(application), support_lifespan(application), proctor_lifespan(application):
        yield

app=FastAPI(title='AI Proctoring API',version='1.0.0',lifespan=application_lifespan)
class PublicUploads(StaticFiles):
    async def get_response(self, path, scope):
        # Unreferenced files, legacy biometric images and subdirectories are
        # never public. The authenticated media routes above handle valid URLs.
        raise HTTPException(404)

app.include_router(private_media_router)
app.mount('/uploads', PublicUploads(directory=Path(__file__).resolve().parents[1] / 'uploads'), name='uploads')
app.add_middleware(CORSMiddleware,allow_origins=settings.CORS_ORIGINS,allow_credentials=True,allow_methods=['*'],allow_headers=['*'])
app.add_middleware(ProctorBodyLimit)

@app.middleware('http')
async def private_preview_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith('/api/v1/recordings/') or (request.url.path.startswith('/api/v1/live-classes/') and '/recording' in request.url.path):
        response.headers['Cache-Control'] = 'private, no-store'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Referrer-Policy'] = 'no-referrer'
    if request.url.path.startswith(('/uploads/', '/api/v1/chat', '/api/v1/identity', '/api/v1/admin/student-cards', '/api/v1/proctoring')) or (request.url.path.startswith('/api/v1/users/') and '/avatar/' in request.url.path):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Pragma'] = 'no-cache'
        response.headers['X-Content-Type-Options'] = 'nosniff'
    return response
def error_content(code:str,message:str,details=None): return {'error':{'code':code,'message':message,'details':details}}
@app.exception_handler(HTTPException)
async def http_error(_:Request,exc:HTTPException):
    detail=exc.detail if isinstance(exc.detail,dict) else {'code':f'HTTP_{exc.status_code}','message':str(exc.detail),'details':None}
    return JSONResponse(status_code=exc.status_code, headers=exc.headers, content={'error':{'code':detail.get('code','HTTP_ERROR'),'message':detail.get('message','Request failed'),'details':detail.get('details')}})
@app.exception_handler(RequestValidationError)
async def validation_error(_:Request,exc:RequestValidationError):
    # Validator context may contain exceptions; inputs may contain credentials.
    details = [{key: value for key, value in error.items() if key not in {'input', 'ctx'}} for error in exc.errors()]
    return JSONResponse(status_code=422, content=error_content('VALIDATION_ERROR','Request validation failed',details))
@app.exception_handler(Exception)
async def server_error(_:Request,__:Exception): return JSONResponse(status_code=500, content=error_content('INTERNAL_ERROR','Internal server error',None))
app.include_router(router,prefix='/api/v1')
install_request_timing(app, engine, enabled=settings.ENVIRONMENT.lower() not in {'production', 'prod'})
