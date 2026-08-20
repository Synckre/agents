"""
Endpoints de Analíticas y Telemetría Técnica de Synckre Agent V2.
"""

from fastapi import APIRouter, Depends
from app.infrastructure.db.manager import db_manager
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/analytics", tags=["Analytics"], dependencies=[Depends(require_internal_key)])


@router.get("/stats", summary="Obtener contadores agregados de telemetría de herramientas")
async def get_stats():
    stats = await db_manager.get_analytics_stats()
    return stats
