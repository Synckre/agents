"""Acceso al pool compartido. Evita import circular con manager."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.infrastructure.db.manager import DatabaseManager


class BaseRepository:
    def __init__(self, db: "DatabaseManager"):
        self._db = db

    async def _ready(self) -> bool:
        return await self._db._ensure_connected()

    @property
    def pool(self):
        return self._db.pool
