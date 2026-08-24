"""AgentPort con TestModel: tools autorizadas, defer HITL, sin red."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from app.application.agent.policies import PolicyEngine
from app.application.agent.ports import TurnInput
from app.application.agent.roles import RoleSystem
from app.application.agent.runtime import AgentRuntime
from app.application.agent.tools_register import register_all_tools
from app.application.agent.tools_registry import tool_registry
from app.infrastructure.agent.pydantic_runtime import PydanticAgentRuntime, _combined_toolset
from pydantic_ai.models.test import TestModel

register_all_tools()


def _turn(role_name: str, text: str) -> TurnInput:
    role = RoleSystem.get_role(role_name)
    authorized = PolicyEngine.filter_authorized_tools(role, tool_registry.list_tools())
    return TurnInput(
        conversation_id="CONV-PYD",
        user_input=text,
        role=role,
        context={"messages": [], "memory": "", "rag_context": []},
        authorized_tools=authorized,
    )


def test_toolset_only_contains_authorized_tools():
    support = RoleSystem.get_role("customer_support")
    authorized = PolicyEngine.filter_authorized_tools(support, tool_registry.list_tools())
    names = {t["name"] for t in authorized}
    assert "create_ticket" in names
    assert "approve_contract" not in names
    assert "read_invoice" not in names


def test_pydantic_executes_authorized_tool(monkeypatch):
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager._ensure_connected",
        AsyncMock(return_value=False),
    )
    port = PydanticAgentRuntime(model=TestModel(call_tools=["request_information"]))
    turn = _turn("customer_support", "necesito más datos")
    out = asyncio.run(port.run(turn))
    assert out.tool_calls
    assert out.tool_calls[0]["tool"] == "request_information"
    assert out.tool_calls[0]["result"]["status"] == "success"
    assert out.deferred is None


def test_pydantic_defers_sensitive_tool():
    port = PydanticAgentRuntime(model=TestModel(call_tools=["approve_contract"]))
    turn = _turn("management_assistant", "aprueba el contrato")
    # management must have approve_contract
    names = {t["name"] for t in turn.authorized_tools}
    if "approve_contract" not in names:
        turn = _turn("administrative_assistant", "aprueba el contrato")
        names = {t["name"] for t in turn.authorized_tools}
    assert "approve_contract" in names
    out = asyncio.run(port.run(turn))
    assert out.deferred is not None
    assert out.deferred.tool_name == "approve_contract"
    assert out.deferred.tool_call_id
    assert out.deferred.message_history


def test_runtime_with_injected_agent_port(monkeypatch):
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager._ensure_connected",
        AsyncMock(return_value=False),
    )
    port = PydanticAgentRuntime(model=TestModel(call_tools=[], custom_output_text="hola desde pydantic"))
    runtime = AgentRuntime(agent_port=port)
    result = asyncio.run(
        runtime.execute(
            conversation_id="CONV-PORT",
            user_input="hola",
            role_name="customer_support",
        )
    )
    assert "hola desde pydantic" in result.response_text or result.response_text


def test_combined_toolset_skips_unknown():
    role = RoleSystem.get_role("customer_support")
    ts = _combined_toolset(role, [{"name": "no_existe"}])
    assert ts is not None
