"""
TaskService & Task State Machine para Synckre Agent V2.

Maneja el ciclo de vida operativo de las Tareas:
- Transiciones de estado: pending -> running -> waiting_human/waiting_user -> completed / failed / cancelled.
- Aprobación Humana (Human-in-the-Loop): approve, reject, edit, request_changes.
- Registro completo en Audit Log (who, when, what, previous_value, new_value, reason).
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from app.infrastructure.db.manager import db_manager
from app.domain import (
    ApprovalModel,
    ApprovalStatus,
    TaskModel,
    TaskStatus,
)

logger = logging.getLogger("task_service")


class TaskService:
    @staticmethod
    async def create_task(
        conversation_id: str,
        task_type: str,
        goal: str,
        context: Optional[Dict[str, Any]] = None,
        approval_required: bool = False,
        priority: str = "normal",
    ) -> TaskModel:
        """Crea una nueva Task en el sistema."""
        import uuid
        task_id = f"TSK-{uuid.uuid4().hex[:8]}"
        task = TaskModel(
            id=task_id,
            conversation_id=conversation_id,
            type=task_type,
            goal=goal,
            status=TaskStatus.WAITING_HUMAN if approval_required else TaskStatus.PENDING,
            priority=priority,
            context=context or {},
            approval_required=approval_required,
            approval_status=ApprovalStatus.PENDING if approval_required else None,
        )
        await db_manager.create_task(task)
        logger.info(f"Task creada: {task_id} (Tipo: {task_type}, Approval Required: {approval_required})")
        return task

    @staticmethod
    async def update_task_status(
        task_id: str,
        status: TaskStatus,
        result: Optional[Dict[str, Any]] = None,
    ) -> Optional[TaskModel]:
        """Actualiza el estado de una Task."""
        task = await db_manager.get_task(task_id)
        if not task:
            logger.warning(f"Task '{task_id}' no encontrada para actualización.")
            return None

        task.status = status
        if result:
            task.result = result
        task.updated_at = datetime.utcnow()

        await db_manager.create_task(task)  # ON CONFLICT DO UPDATE
        logger.info(f"Task '{task_id}' actualizada a estado: {status.value}")
        return task

    @staticmethod
    async def process_approval_decision(
        approval_id: str,
        decision: str,  # 'approve', 'reject', 'edit', 'request_changes'
        approved_by: str,
        reason: Optional[str] = None,
        edited_value: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Procesa la decisión humana sobre una solicitud de aprobación HITL:
        - Actualiza la entidad Approval.
        - Reanuda o completa la Task asociada.
        - Si fue aprobada, ejecuta la herramienta sensible retenida.
        - Registra auditoría inmutable.
        """
        approvals = await db_manager.list_approvals()
        target_approval = next((a for a in approvals if a.id == approval_id), None)
        if not target_approval:
            return {"status": "error", "message": f"Aprobación '{approval_id}' no encontrada."}

        new_status = ApprovalStatus.APPROVED if decision == "approve" else (
            ApprovalStatus.REJECTED if decision == "reject" else ApprovalStatus.CHANGES_REQUESTED
        )

        await db_manager.update_approval(
            approval_id=approval_id,
            status=new_status,
            approved_by=approved_by,
            reason=reason,
            new_value=edited_value or target_approval.new_value,
        )

        # Actualizar Task
        task = await db_manager.get_task(target_approval.task_id)
        execution_result = None

        if task:
            override_args = None
            if edited_value:
                try:
                    override_args = json.loads(edited_value)
                except Exception:
                    override_args = None

            if task.type == "human_escalation":
                if decision == "approve":
                    task.status = TaskStatus.COMPLETED
                    task.approval_status = ApprovalStatus.APPROVED
                elif decision == "reject":
                    task.status = TaskStatus.CANCELLED
                    task.approval_status = ApprovalStatus.REJECTED
                    task.result = {"cancelled_by": approved_by, "reason": reason}
                else:
                    task.status = TaskStatus.WAITING_USER
                    task.approval_status = ApprovalStatus.CHANGES_REQUESTED
                await db_manager.create_task(task)
                await db_manager.update_conversation_status(task.conversation_id, "active")
            elif decision in ("approve", "reject"):
                from app.application.agent.runtime import agent_runtime
                from app.application.jobs import JobKind
                from app.application.services.job_scheduler import job_scheduler

                await job_scheduler.enqueue(
                    kind=JobKind.execute_approved_tool.value,
                    payload={
                        "approval_id": approval_id,
                        "task_id": task.id,
                        "conversation_id": task.conversation_id,
                        "decision": decision,
                        "reason": reason,
                        "override_args": override_args,
                    },
                    idempotency_key=f"hitl:{approval_id}:{decision}",
                )
                resume = await agent_runtime.resume_from_approval(
                    conversation_id=task.conversation_id,
                    task=task,
                    approved=decision == "approve",
                    override_args=override_args,
                    reason=reason,
                )
                execution_result = {"response": resume.response_text, "tool_calls": resume.tool_calls}
                task.status = TaskStatus.COMPLETED if decision == "approve" else TaskStatus.CANCELLED
                task.approval_status = (
                    ApprovalStatus.APPROVED if decision == "approve" else ApprovalStatus.REJECTED
                )
                task.result = execution_result
                await db_manager.create_task(task)
            else:
                task.status = TaskStatus.WAITING_USER
                task.approval_status = ApprovalStatus.CHANGES_REQUESTED
                await db_manager.create_task(task)

        # Audit Log
        await db_manager.log_audit(
            agent_role="human_operator",
            action=f"approval_{decision}",
            user_id=approved_by,
            task_id=task.id if task else None,
            approval_id=approval_id,
            input_summary=f"Decision: {decision}, Reason: {reason}",
            output_summary=json.dumps(execution_result) if execution_result else None,
            authorization_result="authorized",
        )

        return {
            "status": "success",
            "approval_id": approval_id,
            "decision": decision,
            "task_id": task.id if task else None,
            "tool_result": execution_result,
        }


task_service = TaskService()
