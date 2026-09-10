"""Chainlit UI in front of the existing OpenAI-compatible chatbox."""

from __future__ import annotations

import os

import chainlit as cl
import httpx

AGENT_BASE_URL = os.environ.get("AGENT_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
AGENT_MODEL = os.environ.get("AGENT_MODEL", "front_agent")


def _assistant_text(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    return content.strip() if isinstance(content, str) else ""


@cl.on_chat_start
async def on_chat_start() -> None:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(f"{AGENT_BASE_URL}/v1/session")
            response.raise_for_status()
            session = response.json()
    except httpx.HTTPError as error:
        await cl.Message(
            content=(
                "No pude abrir sesión con el agente. "
                f"Arranca `npm run dev` en {AGENT_BASE_URL}.\n\n{error}"
            ),
        ).send()
        return

    api_key = session.get("api_key")
    if not isinstance(api_key, str) or not api_key:
        await cl.Message(content="El agente no devolvió api_key en /v1/session.").send()
        return

    cl.user_session.set("api_key", api_key)
    await cl.Message(content="Hola, soy el asistente de Synckre. ¿En qué te ayudo?").send()


@cl.on_message
async def on_message(message: cl.Message) -> None:
    api_key = cl.user_session.get("api_key")
    if not api_key:
        await cl.Message(content="No hay sesión con el agente. Recarga el chat.").send()
        return

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{AGENT_BASE_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": AGENT_MODEL,
                    "messages": [{"role": "user", "content": message.content}],
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as error:
        detail = error.response.text[:800]
        await cl.Message(content=f"El agente respondió {error.response.status_code}: {detail}").send()
        return
    except httpx.HTTPError as error:
        await cl.Message(content=f"No pude hablar con el agente: {error}").send()
        return

    text = _assistant_text(payload) or "(sin respuesta)"
    await cl.Message(content=text).send()
