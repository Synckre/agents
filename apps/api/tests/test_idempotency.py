"""Idempotencia de tools: misma clave no reejecuta el side effect."""

from __future__ import annotations

import asyncio

from app.application.agent.tools_register import register_all_tools
from app.application.agent.tools_registry import tool_registry
from app.application.agent import tools_registry as tr

register_all_tools()


def test_args_hash_reuses_previous_result(monkeypatch):
    cache: dict = {}
    calls = {"n": 0}

    async def lookup(key: str):
        return cache.get(key)

    async def store(name, args, result, key):
        cache[key] = result

    monkeypatch.setattr(tr, "_lookup_idempotent", lookup)
    monkeypatch.setattr(tr, "_store_idempotent", store)

    tool = tool_registry.get_tool("request_information")
    assert tool is not None
    original_fn = tool.func
    original_strategy = tool.idempotency_strategy
    tool.idempotency_strategy = "args_hash"

    def wrapped(campo_requerido: str, motivo: str):
        calls["n"] += 1
        return original_fn(campo_requerido=campo_requerido, motivo=motivo)

    tool.func = wrapped
    try:
        a = asyncio.run(
            tool_registry.execute_tool(
                "request_information",
                campo_requerido="email",
                motivo="uno",
                conversation_id="C-idem",
            )
        )
        b = asyncio.run(
            tool_registry.execute_tool(
                "request_information",
                campo_requerido="email",
                motivo="uno",
                conversation_id="C-idem",
            )
        )
        assert a["status"] == "success"
        assert b["status"] == "success"
        assert calls["n"] == 1
    finally:
        tool.func = original_fn
        tool.idempotency_strategy = original_strategy
