"""CORS del Control Center contra la API FastAPI."""

from fastapi.testclient import TestClient

from app.interfaces.main import app

DASHBOARD_ORIGIN = "https://control-ai.synckre.com"


def test_cors_preflight_from_control_center():
    client = TestClient(app)
    res = client.options(
        "/api/v1/health",
        headers={
            "Origin": DASHBOARD_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type,x-api-key",
        },
    )
    assert res.status_code in (200, 204)
    assert res.headers.get("access-control-allow-origin") == DASHBOARD_ORIGIN


def test_cors_get_health_from_control_center():
    client = TestClient(app)
    res = client.get("/api/v1/health", headers={"Origin": DASHBOARD_ORIGIN})
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == DASHBOARD_ORIGIN
    body = res.json()
    assert body.get("status") in {"healthy", "degraded"}
    assert "service" in body


def test_liveness_is_immediate_ok():
    client = TestClient(app)
    for path in ("/healthz", "/api/v1/live"):
        res = client.get(path)
        assert res.status_code == 200
        assert res.json().get("status") == "ok"
