"""Rate limit del chat público: no es un chatbot de ocio."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.application.public_limits import CHAT_PER_MINUTE
from app.interfaces.main import app


def test_public_chat_hits_per_minute_limit():
    fake = AsyncMock(return_value={"response": "ok", "conversation_id": "C1", "role": "contact_form_agent"})
    client = TestClient(app)
    with patch("app.interfaces.api.v1.conversations.start_chat", fake):
        codes = []
        for _ in range(CHAT_PER_MINUTE + 2):
            res = client.post("/api/v1/conversations/chat", json={"message": "hola, quiero info de cloud"})
            codes.append(res.status_code)
    assert 429 in codes
    assert codes.count(200) <= CHAT_PER_MINUTE
