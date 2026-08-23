"""Métricas técnicas del agente: Prometheus sin contenido conversacional."""

import asyncio
import time
from unittest.mock import AsyncMock

from app.application.agent.runtime import agent_runtime

from app.infrastructure.metrics_export import prometheus_label, render_prometheus


def test_prometheus_label_strips_unsafe_chars():
    assert prometheus_label("customer_support") == "customer_support"
    assert prometheus_label("hola mundo\n<script>") == "hola_mundo_script"
    assert prometheus_label("") == "unknown"


def test_render_prometheus_has_behavior_series_without_text():
    body = render_prometheus(
        {
            "agent_runs": [
                {"role": "customer_support", "outcome": "success", "channel": "api", "count": 4},
                {"role": "sales_assistant", "outcome": "hitl", "channel": "web", "count": 1},
            ],
            "run_latency": [{"role": "customer_support", "avg_ms": 1200, "p50_ms": 900, "p95_ms": 2100}],
            "llm_calls": [
                {
                    "phase": "plan",
                    "status": "success",
                    "count": 4,
                    "avg_ms": 400,
                    "prompt_tokens": 800,
                    "completion_tokens": 200,
                }
            ],
            "tools": [{"tool": "send_email", "status": "success", "count": 2, "avg_ms": 150}],
            "conversations": [{"status": "active", "role": "customer_support", "channel": "api", "count": 3}],
            "messages": [{"sender": "user", "count": 10}, {"sender": "agent", "count": 10}],
            "tasks": [{"status": "waiting_human", "type": "human_escalation", "count": 1}],
            "approvals": [{"status": "pending", "count": 1}],
            "knowledge_sources": [{"domain": "public", "status": "indexed", "count": 5}],
            "document_chunks": [{"domain": "public", "count": 40}],
            "windows": [{"m5": 1, "h1": 3, "h24": 5}],
        },
        {"pending_approvals": 1, "emails_sent": 2, "rag_queries": 7},
    )
    assert "synckre_agent_runs_total" in body
    assert 'role="customer_support"' in body
    assert 'outcome="hitl"' in body
    assert "synckre_llm_prompt_tokens_total" in body
    assert "synckre_tool_executions_total" in body
    assert 'tool="send_email"' in body
    assert "synckre_agent_runs_window" in body
    assert "Quiero agendar" not in body
    assert "Hola" not in body
    assert "input_data" not in body
    assert "output_summary" not in body


def test_metrics_endpoint_uses_exporter(monkeypatch):
    from fastapi.testclient import TestClient
    from app.interfaces.main import app

    async def fake_stats():
        return {"emails_sent": 3, "pending_approvals": 0}

    async def fake_series():
        return {
            "agent_runs": [{"role": "customer_support", "outcome": "success", "channel": "api", "count": 2}],
            "run_latency": [],
            "llm_calls": [],
            "tools": [],
            "conversations": [],
            "messages": [],
            "tasks": [],
            "approvals": [],
            "knowledge_sources": [],
            "document_chunks": [],
            "windows": [{"m5": 0, "h1": 1, "h24": 2}],
        }

    async def fake_key(_sql, *_args):
        return {"ok": 1}

    monkeypatch.setattr("app.infrastructure.db.manager.db_manager.get_analytics_stats", fake_stats)
    monkeypatch.setattr("app.infrastructure.db.manager.db_manager.get_observability_series", fake_series)
    monkeypatch.setattr("app.interfaces.security.db_manager.fetch_one", fake_key)

    client = TestClient(app)
    res = client.get("/api/v1/analytics/metrics", headers={"x-api-key": "sk_grafana"})
    assert res.status_code == 200
    assert "synckre_agent_runs_total" in res.text
    assert "text/plain" in res.headers.get("content-type", "")


def test_telemetry_flush_does_not_block_execute(monkeypatch):
    """La persistencia de métricas no debe retrasar la respuesta del agente."""

    async def hang(**_kwargs):
        await asyncio.sleep(30)

    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager.persist_run_telemetry",
        hang,
    )
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager._ensure_connected",
        AsyncMock(return_value=False),
    )

    started = time.perf_counter()
    result = asyncio.run(
        agent_runtime.execute(
            conversation_id="CONV-TEL-SPEED",
            user_input="hola",
            role_name="customer_support",
        )
    )
    elapsed = time.perf_counter() - started
    assert result.response_text
    assert elapsed < 2.0, f"execute tardó {elapsed:.2f}s; la telemetría está bloqueando"
