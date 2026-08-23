"""La heurística no corre en producción."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.application.agent.ports import LlmResult
from app.application.agent.runtime import AgentRuntime


def test_production_skips_heuristic(monkeypatch):
    monkeypatch.setattr(
        "app.application.agent.runtime.settings",
        SimpleNamespace(allow_heuristic_fallback=False, is_production=True),
    )
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager._ensure_connected",
        AsyncMock(return_value=False),
    )

    class DeadLlm:
        async def complete(self, system_prompt: str, user_input: str) -> LlmResult:
            return LlmResult(ok=False, source="error")

    runtime = AgentRuntime(llm=DeadLlm())
    result = asyncio.run(
        runtime.execute(
            conversation_id="CONV-PROD",
            user_input="Quiero hablar con un humano por favor",
            role_name="customer_support",
        )
    )
    assert result.task_created is None
    assert "Inténtalo de nuevo" in result.response_text


def test_dev_keeps_heuristic(monkeypatch):
    monkeypatch.setattr(
        "app.application.agent.runtime.settings",
        SimpleNamespace(allow_heuristic_fallback=True, is_production=False),
    )
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager._ensure_connected",
        AsyncMock(return_value=False),
    )

    class DeadLlm:
        async def complete(self, system_prompt: str, user_input: str) -> LlmResult:
            return LlmResult(ok=False, source="skipped")

    runtime = AgentRuntime(llm=DeadLlm())
    result = asyncio.run(
        runtime.execute(
            conversation_id="CONV-DEV",
            user_input="Quiero hablar con un humano por favor",
            role_name="customer_support",
        )
    )
    assert result.task_created is not None
