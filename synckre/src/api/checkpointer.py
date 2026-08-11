"""Persistencia del estado con langgraph-checkpoint-postgres.

Pool de conexiones (psycopg_pool.AsyncConnectionPool) compartido durante toda
la vida de la app: PostgresSaver.setup() se ejecuta UNA vez en el arranque,
nunca por request. Para tests/sin-DB existe el backend "memory".
"""

from __future__ import annotations

import asyncio
from typing import Any, cast

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool

from api.settings import Settings

MAX_POOL_SIZE = 10
DB_READY_RETRIES = 20
DB_READY_DELAY_SECONDS = 2.0


class CheckpointerHandle:
    """Mantiene vivos el saver y su pool de conexiones mientras corre la app."""

    def __init__(self, saver: Any, pool: AsyncConnectionPool | None) -> None:
        """Guarda el saver y su pool de conexiones."""
        self.saver = saver
        self.pool = pool

    async def close(self) -> None:
        """Cierra el pool al apagar la app."""
        if self.pool is not None:
            await self.pool.close()


async def _wait_for_postgres(pool: AsyncConnectionPool, settings: Settings) -> None:
    """Reintenta hasta que Postgres acepte conexiones (Postgres tarda en arrancar)."""
    last_error: Exception | None = None
    for attempt in range(1, DB_READY_RETRIES + 1):
        try:
            await pool.wait(timeout=DB_READY_DELAY_SECONDS)
            return
        except Exception as exc:  # noqa: BLE001 - reintentos de arranque
            last_error = exc
            if attempt < DB_READY_RETRIES:
                await asyncio.sleep(DB_READY_DELAY_SECONDS)
    raise RuntimeError(
        f"No se pudo conectar a Postgres tras {DB_READY_RETRIES} intentos: {last_error}"
    ) from last_error


async def create_checkpointer(settings: Settings) -> CheckpointerHandle:
    """Crea el checkpointer: Postgres por defecto (con setup()), memory para tests."""
    if settings.checkpointer_backend != "postgres":
        return CheckpointerHandle(InMemorySaver(), None)

    pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        kwargs={"autocommit": True},
        open=False,
        min_size=1,
        max_size=MAX_POOL_SIZE,
    )
    await pool.open()
    try:
        await _wait_for_postgres(pool, settings)
        saver = AsyncPostgresSaver(cast(Any, pool))
        # Crea las tablas del checkpointer si no existen (solo en el arranque).
        await saver.setup()
    except Exception:
        await pool.close()
        raise
    return CheckpointerHandle(saver, pool)


async def get_thread_messages(
    checkpointer: Any, thread_id: str
) -> list[dict[str, str]]:
    """Recupera el historial de mensajes de un thread desde el checkpointer."""
    config = {"configurable": {"thread_id": thread_id}}
    checkpoint = await checkpointer.aget_tuple(config)
    if checkpoint is None:
        return []
    channel_values = (checkpoint.checkpoint or {}).get("channel_values", {}) or {}
    messages = channel_values.get("messages", []) or []
    result: list[dict[str, str]] = []
    for message in messages:
        if hasattr(message, "type") and hasattr(message, "content"):
            role = str(message.type)
            content = str(message.content)
        elif isinstance(message, dict):
            role = str(message.get("type", "unknown"))
            content = str(message.get("content", ""))
        else:
            continue
        # Solo conversación visible: salta routing del supervisor (tool-calls) y vacíos.
        if not content or role == "tool":
            continue
        result.append({"role": role, "content": content})
    return result
