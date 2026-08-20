"""
Endpoints de Gestión de Tareas (Tasks) para Synckre Agent V2.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from app.infrastructure.db.manager import db_manager
from app.domain import TaskStatus
from app.application.tasks.service import task_service
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/tasks", tags=["Tasks"], dependencies=[Depends(require_internal_key)])


@router.get("", summary="Listar tareas operativas")
async def list_tasks(limit: int = 50):
    tasks = await db_manager.list_tasks(limit=limit)
    return [t.dict() for t in tasks]


@router.get("/{id}", summary="Obtener detalles de una tarea")
async def get_task(id: str):
    task = await db_manager.get_task(id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Tarea '{id}' no encontrada.")
    return task.dict()


@router.post("/{id}/cancel", summary="Cancelar una tarea")
async def cancel_task(id: str, reason: Optional[str] = "Cancelado desde API"):
    updated = await task_service.update_task_status(
        task_id=id,
        status=TaskStatus.CANCELLED,
        result={"cancelled_reason": reason},
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Tarea '{id}' no encontrada.")
    # Si era una escalación, la conversación vuelve a estar operativa para el agente
    if updated.type == "human_escalation":
        await db_manager.update_conversation_status(updated.conversation_id, "active")
    return updated.dict()
