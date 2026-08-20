"""
Endpoints de Audit Logs para Synckre Agent V2.
"""

from typing import Optional
from fastapi import APIRouter, Depends
from app.infrastructure.db.manager import db_manager
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/audit", tags=["Audit"], dependencies=[Depends(require_internal_key)])


@router.get("", summary="Listar registros de auditoría")
async def list_audit_logs(limit: int = 100):
    logs = await db_manager.list_audit_logs(limit=limit)
    return logs


@router.get("/tool-executions", summary="Listar telemetría detallada de ejecuciones de herramientas")
async def list_tool_executions(conversation_id: Optional[str] = None, limit: int = 50):
    logs = await db_manager.list_tool_executions(conversation_id=conversation_id, limit=limit)
    return logs
