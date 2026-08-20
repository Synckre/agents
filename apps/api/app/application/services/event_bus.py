"""
EventBus — colas en memoria por conversación para transmitir en vivo el
progreso de la ejecución del agente (tools, razonamiento) vía SSE al frontend.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict


class EventBus:
    def __init__(self) -> None:
        self._queues: Dict[str, asyncio.Queue] = {}
        self._subscribers: Dict[str, int] = {}

    def subscribe(self, conversation_id: str) -> asyncio.Queue:
        q = self._queues.setdefault(conversation_id, asyncio.Queue(maxsize=200))
        self._subscribers[conversation_id] = self._subscribers.get(conversation_id, 0) + 1
        return q

    def unsubscribe(self, conversation_id: str) -> None:
        self._subscribers[conversation_id] = max(0, self._subscribers.get(conversation_id, 0) - 1)
        if self._subscribers[conversation_id] == 0:
            self._queues.pop(conversation_id, None)
            self._subscribers.pop(conversation_id, None)

    async def publish(self, conversation_id: str, event: Dict[str, Any]) -> None:
        """Solo publica si hay alguien escuchando (evita acumular colas sin consumidor)."""
        if self._subscribers.get(conversation_id, 0) > 0:
            q = self._queues.get(conversation_id)
            if q:
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    pass


event_bus = EventBus()
