"""
Endpoints de Gestión de Trabajos Diferidos (Jobs y Schedulers) para Synckre Agent V2.
Expone el estado de ejecución de background jobs, cronjobs y tareas programadas.
"""

from typing import Optional
from fastapi import APIRouter, Depends
from app.infrastructure.db.manager import db_manager
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/jobs", tags=["Jobs"], dependencies=[Depends(require_internal_key)])


@router.get("", summary="Listar trabajos en segundo plano (Jobs & Cronjobs)")
async def list_jobs(status: Optional[str] = None, limit: int = 50):
    jobs = await db_manager.list_jobs(status=status, limit=limit)
    return [
        {
            "id": j.id,
            "kind": j.kind,
            "status": j.status,
            "run_at": j.run_at.isoformat() if j.run_at else None,
            "payload": j.payload,
            "attempts": j.attempts,
            "max_attempts": j.max_attempts,
            "idempotency_key": j.idempotency_key,
            "last_error": j.last_error,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "updated_at": j.updated_at.isoformat() if j.updated_at else None,
        }
        for j in jobs
    ]
