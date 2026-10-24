from sqlalchemy import text
from sqlalchemy.orm import Session
def database_status(db: Session) -> str:
    db.execute(text('SELECT 1'))
    return 'ok'

