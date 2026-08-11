import pytest

from agent import graph

pytestmark = pytest.mark.anyio


@pytest.mark.langsmith
async def test_agent_supervisor_workers() -> None:
    """E2E real contra DeepSeek: el supervisor debe delegar y responder."""
    inputs = {
        "messages": [{"role": "user", "content": "Responde con una sola palabra: hola"}]
    }
    res = await graph.ainvoke(inputs)
    assert res is not None
    assert res.get("messages")
