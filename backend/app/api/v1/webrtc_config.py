from fastapi import APIRouter
from app.core.config import settings

router = APIRouter()

@router.get('/config/webrtc')
def get_webrtc_config():
    return {'data': {'ice_servers': [{'urls': url.strip()} for url in settings.WEBRTC_STUN_SERVERS.split(',') if url.strip()]}}
