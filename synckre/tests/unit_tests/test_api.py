"""Tests unitarios de la API (sin LLM real ni Postgres: backend memory + grafo fake)."""

from __future__ import annotations

from typing import Annotated, Any, Generator, TypedDict

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, AnyMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from api.main import app, limiter

HEADERS = {"X-API-Key": "test-key-1"}


def _fake_build_graph(llm: Any = None, checkpointer: Any = None) -> Any:
    """Grafo mínimo que escribe checkpoints reales (para probar historial) sin llamar al LLM."""

    class _State(TypedDict):
        messages: Annotated[list[AnyMessage], add_messages]

    def _node(state: _State) -> dict[str, list[AnyMessage]]:
        return {"messages": [AIMessage(content="respuesta de prueba")]}

    builder = StateGraph(_State)
    builder.add_node("n", _node)
    builder.add_edge(START, "n")
    builder.add_edge("n", END)
    return builder.compile(checkpointer=checkpointer)


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    """Cliente con lifespan real pero grafo fake y checkpointer en memoria."""
    limiter.reset()
    monkeypatch.setattr("api.main.build_graph", _fake_build_graph)
    with TestClient(app) as test_client:
        yield test_client


def test_health_sin_auth(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_invoke_requiere_api_key(client: TestClient) -> None:
    res = client.post("/invoke", json={"thread_id": "t1", "mensaje": "hola"})
    assert res.status_code == 401


def test_invoke_api_key_invalida(client: TestClient) -> None:
    res = client.post(
        "/invoke",
        json={"thread_id": "t1", "mensaje": "hola"},
        headers={"X-API-Key": "clave-incorrecta"},
    )
    assert res.status_code == 401


def test_invoke_ok(client: TestClient) -> None:
    res = client.post(
        "/invoke",
        json={"thread_id": "t1", "mensaje": "hola"},
        headers=HEADERS,
    )
    assert res.status_code == 200
    assert res.json()["respuesta"] == "respuesta de prueba"


def test_invoke_validacion_422(client: TestClient) -> None:
    # thread_id con carácter no permitido
    res = client.post(
        "/invoke",
        json={"thread_id": "id con espacios", "mensaje": "hola"},
        headers=HEADERS,
    )
    assert res.status_code == 422
    # campo extra (extra="forbid")
    res = client.post(
        "/invoke",
        json={"thread_id": "t1", "mensaje": "hola", "extra": 1},
        headers=HEADERS,
    )
    assert res.status_code == 422


def test_body_limit_413(client: TestClient) -> None:
    res = client.post(
        "/invoke",
        json={"thread_id": "t1", "mensaje": "x" * 5000},
        headers=HEADERS,
    )
    assert res.status_code == 413


def test_rate_limit_429(client: TestClient) -> None:
    for _ in range(10):
        res = client.post(
            "/invoke",
            json={"thread_id": "t-rate", "mensaje": "hola"},
            headers=HEADERS,
        )
        assert res.status_code == 200
    res = client.post(
        "/invoke",
        json={"thread_id": "t-rate", "mensaje": "hola"},
        headers=HEADERS,
    )
    assert res.status_code == 429


def test_history_con_persistencia(client: TestClient) -> None:
    for _ in range(2):
        res = client.post(
            "/invoke",
            json={"thread_id": "t-hist", "mensaje": "hola"},
            headers=HEADERS,
        )
        assert res.status_code == 200
    res = client.get("/threads/t-hist/history", headers=HEADERS)
    assert res.status_code == 200
    data = res.json()
    assert data["thread_id"] == "t-hist"
    assert len(data["mensajes"]) == 4  # 2 human + 2 ai
    roles = [m["role"] for m in data["mensajes"]]
    assert roles.count("human") == 2
    assert roles.count("ai") == 2


def test_history_requiere_auth(client: TestClient) -> None:
    res = client.get("/threads/t1/history")
    assert res.status_code == 401


def test_stream_sse(client: TestClient) -> None:
    with client.stream(
        "POST",
        "/stream",
        json={"thread_id": "t-stream", "mensaje": "hola"},
        headers=HEADERS,
    ) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        body = "".join(res.iter_text())
    assert '"type": "inicio"' in body
    assert '"type": "fin"' in body


def test_security_headers_presentes(client: TestClient) -> None:
    res = client.get("/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "strict-transport-security" in res.headers
