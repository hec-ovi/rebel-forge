from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends

from rebel_forge_backend.db.session import get_db

router = APIRouter()


@router.get("/health")
def healthcheck(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}

