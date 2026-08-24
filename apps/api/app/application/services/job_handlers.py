"""Handlers de synckre.jobs. Se registran en el composition root."""

from __future__ import annotations

import logging

from app.application.jobs import Job, JobKind
from app.application.agent.prepare_args import prepare_tool_args
from app.application.agent.tools_registry import tool_registry
from app.domain import TaskStatus
from app.infrastructure.db.manager import db_manager

logger = logging.getLogger("job_handlers")


async def handle_execute_approved_tool(job: Job) -> None:
    payload = job.payload or {}
    task_id = payload.get("task_id")
    if not task_id:
        return
    task = await db_manager.get_task(task_id)
    if not task or task.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        return
    from app.application.agent.runtime import agent_runtime

    decision = payload.get("decision") or "approve"
    await agent_runtime.resume_from_approval(
        conversation_id=task.conversation_id,
        task=task,
        approved=decision == "approve",
        override_args=payload.get("override_args"),
        reason=payload.get("reason"),
    )
    task = await db_manager.get_task(task_id) or task
    task.status = TaskStatus.COMPLETED if decision == "approve" else TaskStatus.CANCELLED
    await db_manager.create_task(task)


async def handle_resume_turn(job: Job) -> None:
    await handle_execute_approved_tool(job)


async def handle_retry_tool(job: Job) -> None:
    payload = job.payload or {}
    tool_name = payload.get("tool_name")
    if not tool_name:
        return
    conversation_id = payload.get("conversation_id") or ""
    args = dict(payload.get("tool_args") or {})
    exec_args = await prepare_tool_args(
        tool_name, args, conversation_id=conversation_id, user_input=""
    )
    result = await tool_registry.execute_tool(tool_name, **exec_args)
    status = (result or {}).get("status")
    await db_manager.log_tool_execution(
        conversation_id=conversation_id or "JOB",
        tool_name=tool_name,
        input_data=exec_args,
        output_data=result,
        status=status or "unknown",
    )
    if status == "temporary_failure":
        raise RuntimeError((result or {}).get("error") or "temporary_failure")


def register_job_handlers(scheduler) -> None:
    scheduler.register(JobKind.execute_approved_tool.value, handle_execute_approved_tool)
    scheduler.register(JobKind.resume_turn.value, handle_resume_turn)
    scheduler.register(JobKind.retry_tool.value, handle_retry_tool)
