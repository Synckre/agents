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
