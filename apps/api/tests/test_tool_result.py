"""Contrato ToolResult y normalización en ToolRegistry."""

from __future__ import annotations

import asyncio

from app.application.agent.results import ToolResult, ToolStatus
from app.application.agent.tools_register import register_all_tools
from app.application.agent.tools_registry import tool_registry

register_all_tools()


def test_from_raw_legacy_dict_keeps_extra_keys():
    raw = {
        "status": "success",
        "message": "Lead creado",
        "ticket_id": "ISS-1",
        "requires_human": False,
    }
    result = ToolResult.from_raw(raw)
    assert result.status is ToolStatus.success
    dumped = result.to_dict()
    assert dumped["status"] == "success"
    assert dumped["message"] == "Lead creado"
    assert dumped["ticket_id"] == "ISS-1"
    assert "requires_human" not in dumped


def test_from_raw_requires_human_flag():
    result = ToolResult.from_raw(
        {"status": "success", "message": "Escalado", "requires_human": True, "ticket_id": "T-1"}
    )
    assert result.status is ToolStatus.requires_human
    dumped = result.to_dict()
    assert dumped["requires_human"] is True
    assert dumped["ticket_id"] == "T-1"


def test_from_raw_keeps_requires_human_on_temporary_failure():
    """escalate_ticket puede fallar en ERP y aún así pedir humano."""
    result = ToolResult.from_raw(
        {
            "status": "temporary_failure",
            "requires_human": True,
            "message": "No se pudo crear la escalación",
        }
    )
    assert result.status is ToolStatus.temporary_failure
    assert result.to_dict()["requires_human"] is True


def test_from_raw_unknown_status_defaults_success():
    result = ToolResult.from_raw({"status": "weird", "foo": 1})
    assert result.status is ToolStatus.success
    assert result.to_dict()["foo"] == 1


def test_from_raw_non_dict():
    result = ToolResult.from_raw("ok")
    assert result.status is ToolStatus.success
    assert result.to_dict()["result"] == "ok"


def test_execute_tool_still_returns_legacy_dict():
    res = asyncio.run(
        tool_registry.execute_tool(
            "request_information",
            campo_requerido="email",
            motivo="Prueba",
        )
    )
    assert isinstance(res, dict)
    assert res["status"] == "success"
    assert res.get("message")


def test_execute_tool_missing_params_normalized():
    res = asyncio.run(tool_registry.execute_tool("request_information", message="solo"))
    assert res["status"] == ToolStatus.permanent_failure.value
    assert "campo_requerido" in res["error"]
