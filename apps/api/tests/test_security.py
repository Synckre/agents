"""Auth: API interna exige Clerk; health y contacto público no."""

from fastapi.testclient import TestClient

from app.interfaces.main import app
from app.interfaces.security import resolve_allowed_role


def test_health_without_session():
    client = TestClient(app)
    res = client.get("/api/v1/health")
    assert res.status_code == 200


def test_live_without_session():
    client = TestClient(app)
    assert client.get("/healthz").status_code == 200
    assert client.get("/api/v1/live").status_code == 200


def test_knowledge_requires_session():
    client = TestClient(app)
    res = client.get("/api/v1/knowledge")
    assert res.status_code == 401


def test_conversations_list_requires_session():
    client = TestClient(app)
    assert client.get("/api/v1/conversations").status_code == 401


def test_approvals_require_session():
    client = TestClient(app)
    assert client.get("/api/v1/approvals").status_code == 401


def test_leads_require_session():
    client = TestClient(app)
    assert client.get("/api/v1/leads").status_code == 401


def test_audit_requires_session():
    client = TestClient(app)
    assert client.get("/api/v1/audit").status_code == 401


def test_send_message_requires_session():
    client = TestClient(app)
    res = client.post(
        "/api/v1/conversations/CONV-fake/messages",
        json={"message": "hola"},
    )
    assert res.status_code == 401


def test_events_require_session():
    client = TestClient(app)
    assert client.get("/api/v1/conversations/CONV-fake/events").status_code == 401


def test_public_contact_is_open():
    client = TestClient(app)
    res = client.post(
        "/api/v1/public/contact",
        json={"name": "", "email": "", "message": ""},
    )
    assert res.status_code == 400


def test_public_chat_forces_contact_role():
    assert resolve_allowed_role("public", "operations_assistant") == "contact_form_agent"


def test_admin_role_can_select_sales():
    assert resolve_allowed_role("admin", "sales_assistant") == "sales_assistant"


def test_bogus_bearer_rejected():
    client = TestClient(app)
    res = client.get(
        "/api/v1/knowledge",
        headers={"Authorization": "Bearer not-a-clerk-token"},
    )
    assert res.status_code == 401


def test_analytics_metrics_requires_auth():
    client = TestClient(app)
    assert client.get("/api/v1/analytics/metrics").status_code == 401


def test_analytics_metrics_rejects_unknown_api_key(monkeypatch):
    async def missing(_sql, *_args):
        return None

    monkeypatch.setattr("app.interfaces.security.db_manager.fetch_one", missing)
    client = TestClient(app)
    res = client.get(
        "/api/v1/analytics/metrics",
        headers={"x-api-key": "sk_unknown"},
    )
    assert res.status_code == 401


def _mock_observability(monkeypatch):
    async def fake_stats():
        return {"emails_sent": 0, "total_executions": 0}

    async def fake_series():
        return {
            "agent_runs": [],
            "run_latency": [],
            "llm_calls": [],
            "tools": [],
            "conversations": [],
            "messages": [],
            "tasks": [],
            "approvals": [],
            "knowledge_sources": [],
            "document_chunks": [],
            "windows": [{"m5": 0, "h1": 0, "h24": 0}],
        }

    monkeypatch.setattr("app.infrastructure.db.manager.db_manager.get_analytics_stats", fake_stats)
    monkeypatch.setattr("app.infrastructure.db.manager.db_manager.get_observability_series", fake_series)


def test_analytics_metrics_accepts_active_x_api_key(monkeypatch):
    async def active_row(_sql, *_args):
        return {"ok": 1}

    _mock_observability(monkeypatch)
    monkeypatch.setattr("app.interfaces.security.db_manager.fetch_one", active_row)
    client = TestClient(app)
    res = client.get(
        "/api/v1/analytics/metrics",
        headers={"x-api-key": "sk_grafana"},
    )
    assert res.status_code == 200
    assert "synckre_tool_executions_total" in res.text


def test_analytics_metrics_accepts_bearer_sk_key(monkeypatch):
    async def active_row(_sql, *_args):
        return {"ok": 1}

    _mock_observability(monkeypatch)
    monkeypatch.setattr("app.interfaces.security.db_manager.fetch_one", active_row)
    client = TestClient(app)
    res = client.get(
        "/api/v1/analytics/metrics",
        headers={"Authorization": "Bearer sk_grafana"},
    )
    assert res.status_code == 200
