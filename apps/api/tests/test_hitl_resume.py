"""HITL: approve escribe respuesta; reject no ejecuta la tool."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.application.agent.ports import TurnInput
from app.application.agent.policies import PolicyEngine
from app.application.agent.roles import RoleSystem
from app.application.agent.runtime import AgentRuntime
from app.application.agent.tools_register import register_all_tools
from app.application.agent.tools_registry import tool_registry
from app.domain import ApprovalStatus, TaskModel, TaskStatus
from app.infrastructure.agent.pydantic_runtime import PydanticAgentRuntime
from pydantic_ai.models.test import TestModel

register_all_tools()


def test_resume_reject_does_not_execute_tool(monkeypatch):
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager._ensure_connected",
        AsyncMock(return_value=False),
    )
    port = PydanticAgentRuntime(model=TestModel(call_tools=["approve_contract"]))
    runtime = AgentRuntime(agent_port=port)
    role = RoleSystem.get_role("management_assistant")
    authorized = PolicyEngine.filter_authorized_tools(role, tool_registry.list_tools())
    turn = TurnInput(
        conversation_id="CONV-HITL",
        user_input="aprueba",
        role=role,
        context={"messages": []},
        authorized_tools=authorized,
    )
    first = asyncio.run(port.run(turn))
    assert first.deferred is not None
    task = TaskModel(
        id="TSK-HITL",
        conversation_id="CONV-HITL",
        type="human_approval",
        goal="approve",
        status=TaskStatus.WAITING_HUMAN,
        approval_required=True,
        approval_status=ApprovalStatus.PENDING,
        context={
            "tool_name": first.deferred.tool_name,
            "tool_args": first.deferred.tool_args,
            "tool_call_id": first.deferred.tool_call_id,
            "message_history": first.deferred.message_history,
            "role": "management_assistant",
        },
    )
    result = asyncio.run(
        runtime.resume_from_approval(
            conversation_id="CONV-HITL",
            task=task,
            approved=False,
            reason="no",
        )
    )
    executed_names = [c.get("tool") for c in result.tool_calls]
    assert "approve_contract" not in executed_names or not any(
        (c.get("result") or {}).get("status") == "success" for c in result.tool_calls
    )
    assert result.response_text


def test_approval_service_resume_mocked():
    from app.application.tasks.service import TaskService
    from app.domain import ApprovalModel

    approval = ApprovalModel(
        id="APP-1",
        task_id="TSK-1",
        target_type="tool_execution",
        action="approve_contract",
    )
    task = TaskModel(
        id="TSK-1",
        conversation_id="CONV-1",
        type="human_approval",
        goal="x",
        status=TaskStatus.WAITING_HUMAN,
        context={"tool_name": "approve_contract", "tool_args": {}, "role": "management_assistant"},
    )

    class Resume:
        response_text = "contrato aprobado"
        tool_calls = [{"tool": "approve_contract", "result": {"status": "success"}}]

    with patch("app.infrastructure.db.manager.db_manager.list_approvals", AsyncMock(return_value=[approval])), \
         patch("app.infrastructure.db.manager.db_manager.update_approval", AsyncMock()), \
         patch("app.infrastructure.db.manager.db_manager.get_task", AsyncMock(return_value=task)), \
         patch("app.infrastructure.db.manager.db_manager.create_task", AsyncMock()), \
         patch("app.infrastructure.db.manager.db_manager.log_audit", AsyncMock()), \
         patch("app.application.services.job_scheduler.job_scheduler.enqueue", AsyncMock()), \
         patch("app.application.agent.runtime.agent_runtime.resume_from_approval", AsyncMock(return_value=Resume())):
        out = asyncio.run(
            TaskService.process_approval_decision("APP-1", "approve", "op", reason="ok")
        )
    assert out["status"] == "success"
    assert out["tool_result"]["response"] == "contrato aprobado"
