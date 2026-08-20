"""
Endpoints de Aprobaciones Humanas (HITL) para Synckre Agent V2.
"""

from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.infrastructure.db.manager import db_manager
from app.application.tasks.service import task_service
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/approvals", tags=["Approvals"], dependencies=[Depends(require_internal_key)])


class ApprovalDecisionRequest(BaseModel):
    approved_by: str = "human_operator"
    reason: Optional[str] = None
    edited_value: Optional[str] = None


@router.get("", summary="Listar cola de aprobaciones humanas")
async def list_approvals(status: Optional[str] = None, limit: int = 50):
    approvals = await db_manager.list_approvals(status=status, limit=limit)
    return [a.dict() for a in approvals]


@router.post("/{id}/approve", summary="Aprobar una solicitud retenida")
async def approve_request(id: str, req: ApprovalDecisionRequest):
    res = await task_service.process_approval_decision(
        approval_id=id,
        decision="approve",
        approved_by=req.approved_by,
        reason=req.reason,
        edited_value=req.edited_value,
    )
    return res


@router.post("/{id}/reject", summary="Rechazar una solicitud retenida")
async def reject_request(id: str, req: ApprovalDecisionRequest):
    res = await task_service.process_approval_decision(
        approval_id=id,
        decision="reject",
        approved_by=req.approved_by,
        reason=req.reason,
    )
    return res
