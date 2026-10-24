from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.responses import ok
from app.core.database import get_db
from app.services.health import database_status
router = APIRouter()
@router.get('/health')
def health(db: Session = Depends(get_db)):
    try: return ok({'status':'ok','database':database_status(db)})
    except Exception: return ok({'status':'degraded','database':'unavailable'})

