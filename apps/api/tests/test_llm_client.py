"""Cliente LLM: HTTP aislado del runtime; retries y skip sin heurística."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.application.agent.ports import LlmResult
from app.infrastructure.llm.deepseek import DeepseekLlm


def test_deepseek_skipped_without_key():
    client = DeepseekLlm(api_key="", skip=False)
    result = asyncio.run(client.complete("sys", "hola"))
    assert result.ok is False
    assert result.source == "skipped"
    assert result.attempts == []


def test_deepseek_skipped_when_flag():
    client = DeepseekLlm(api_key="sk-real", skip=True)
    result = asyncio.run(client.complete("sys", "hola"))
    assert result.source == "skipped"


def test_deepseek_success_parses_usage():
    payload = {
        "choices": [{"message": {"content": '{"answer":"ok","tool_to_call":null,"tool_args":{}}'}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 4},
    }
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = payload

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.infrastructure.llm.deepseek.httpx.AsyncClient", return_value=mock_client):
        client = DeepseekLlm(api_key="sk-test", skip=False)
        result = asyncio.run(client.complete("sys", "hola"))

    assert result.ok is True
    assert result.source == "llm"
    assert result.prompt_tokens == 11
    assert result.completion_tokens == 4
    assert result.attempts[0].status == "success"
    assert '"answer"' in result.content


def test_deepseek_retries_then_error():
    response = MagicMock()
    response.status_code = 500
    response.text = "boom"

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.infrastructure.llm.deepseek.httpx.AsyncClient", return_value=mock_client):
        with patch("app.infrastructure.llm.deepseek.asyncio.sleep", AsyncMock()):
            client = DeepseekLlm(api_key="sk-test", skip=False)
            result = asyncio.run(client.complete("sys", "hola"))

    assert result.ok is False
    assert result.source == "error"
    assert len(result.attempts) == 2
    assert mock_client.post.call_count == 2


def test_runtime_uses_injected_llm(monkeypatch):
    from app.application.agent.runtime import AgentRuntime

    class FakeLlm:
        async def complete(self, system_prompt: str, user_input: str) -> LlmResult:
            return LlmResult(
                ok=True,
                source="llm",
                content='{"answer":"inyectado","tool_to_call":null,"tool_args":{}}',
            )

    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager._ensure_connected",
        AsyncMock(return_value=False),
    )
    runtime = AgentRuntime(llm=FakeLlm())
    result = asyncio.run(
        runtime.execute(
            conversation_id="CONV-LLM-PORT",
            user_input="hola",
            role_name="customer_support",
        )
    )
    assert "inyectado" in result.response_text
