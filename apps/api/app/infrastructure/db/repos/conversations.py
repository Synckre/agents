"""Persistencia de conversaciones y mensajes."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.domain import ConversationModel, MessageModel
from app.infrastructure.db.repos.base import BaseRepository

logger = logging.getLogger("db.conversations")


class ConversationRepository(BaseRepository):
    async def create(self, conv: ConversationModel) -> ConversationModel:
        if not await self._ready():
            return conv
        sql = """
        INSERT INTO synckre.conversations
            (id, channel, user_id, customer_id, role, status, created_at, updated_at, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at,
            metadata = EXCLUDED.metadata;
        """
        async with self.pool.connection() as conn:
            await conn.execute(
                sql,
                (
                    conv.id,
                    conv.channel.value if hasattr(conv.channel, "value") else str(conv.channel),
                    conv.user_id,
                    conv.customer_id,
                    conv.role,
                    conv.status,
                    conv.created_at,
                    conv.updated_at,
                    json.dumps(conv.metadata),
                ),
            )
        return conv

    async def get(self, conversation_id: str) -> Optional[ConversationModel]:
        if not await self._ready():
            return None
        sql = """
        SELECT id, channel, user_id, customer_id, role, status, created_at, updated_at, metadata
        FROM synckre.conversations
        WHERE id = %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (conversation_id,))
                row = await cur.fetchone()
                if not row:
                    return None
                return ConversationModel(
                    id=row[0],
                    channel=row[1],
                    user_id=row[2],
                    customer_id=row[3],
                    role=row[4],
                    status=row[5],
                    created_at=row[6],
                    updated_at=row[7],
                    metadata=row[8] if isinstance(row[8], dict) else json.loads(row[8] or "{}"),
                )

    async def list(self, limit: int = 50) -> List[ConversationModel]:
        if not await self._ready():
            return []
        sql = """
        SELECT id, channel, user_id, customer_id, role, status, created_at, updated_at, metadata
        FROM synckre.conversations
        ORDER BY updated_at DESC
        LIMIT %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (limit,))
                rows = await cur.fetchall()
                return [
                    ConversationModel(
                        id=r[0],
                        channel=r[1],
                        user_id=r[2],
                        customer_id=r[3],
                        role=r[4],
                        status=r[5],
                        created_at=r[6],
                        updated_at=r[7],
                        metadata=r[8] if isinstance(r[8], dict) else json.loads(r[8] or "{}"),
                    )
                    for r in rows
                ]

    async def delete(self, conversation_id: str) -> bool:
        if not await self._ready():
            return False
        sql = "DELETE FROM synckre.conversations WHERE id = %s;"
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (conversation_id,))
                return (cur.rowcount or 0) > 0

    async def update_status(self, conversation_id: str, status: str) -> bool:
        if not await self._ready():
            return False
        sql = "UPDATE synckre.conversations SET status = %s, updated_at = %s WHERE id = %s;"
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (status, datetime.utcnow(), conversation_id))
                return (cur.rowcount or 0) > 0

    async def update_role(self, conversation_id: str, role: str) -> bool:
        if not await self._ready():
            return False
        sql = "UPDATE synckre.conversations SET role = %s, updated_at = %s WHERE id = %s;"
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (role, datetime.utcnow(), conversation_id))
                return (cur.rowcount or 0) > 0

    async def get_by_resume_token(self, token: str) -> Optional[ConversationModel]:
        if not token or not await self._ready():
            return None
        sql = """
        SELECT id, channel, user_id, customer_id, role, status, created_at, updated_at, metadata
        FROM synckre.conversations
        WHERE metadata->>'resume_token' = %s
        LIMIT 1;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (token,))
                row = await cur.fetchone()
        if not row:
            return None
        return ConversationModel(
            id=row[0],
            channel=row[1],
            user_id=row[2],
            customer_id=row[3],
            role=row[4],
            status=row[5],
            created_at=row[6],
            updated_at=row[7],
            metadata=row[8] if isinstance(row[8], dict) else json.loads(row[8] or "{}"),
        )

    async def update_metadata(self, conversation_id: str, metadata: Dict[str, Any]) -> bool:
        if not await self._ready():
            return False
        sql = "UPDATE synckre.conversations SET metadata = metadata || %s::jsonb, updated_at = %s WHERE id = %s;"
        try:
            async with self.pool.connection() as conn:
                await conn.execute(sql, (json.dumps(metadata), datetime.utcnow(), conversation_id))
            return True
        except Exception as exc:
            logger.error("Error actualizando metadata de conversación: %s", exc)
            return False

    async def add_message(self, msg: MessageModel) -> MessageModel:
        if not await self._ready():
            return msg
        sql = """
        INSERT INTO synckre.messages
            (id, conversation_id, sender, content, message_type, tool_calls, created_at, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
        """
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute(
                    sql,
                    (
                        msg.id,
                        msg.conversation_id,
                        msg.sender,
                        msg.content,
                        msg.message_type,
                        json.dumps(msg.tool_calls or []),
                        msg.created_at,
                        json.dumps(msg.metadata),
                    ),
                )
                await conn.execute(
                    "UPDATE synckre.conversations SET updated_at = %s WHERE id = %s;",
                    (msg.created_at, msg.conversation_id),
                )
        return msg

    async def get_messages(self, conversation_id: str, limit: int = 50) -> List[MessageModel]:
        if not await self._ready():
            return []
        sql = """
        SELECT id, conversation_id, sender, content, message_type, tool_calls, created_at, metadata
        FROM synckre.messages
        WHERE conversation_id = %s
        ORDER BY created_at ASC
        LIMIT %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (conversation_id, limit))
                rows = await cur.fetchall()
                return [
                    MessageModel(
                        id=r[0],
                        conversation_id=r[1],
                        sender=r[2],
                        content=r[3],
                        message_type=r[4],
                        tool_calls=r[5] if isinstance(r[5], list) else json.loads(r[5] or "[]"),
                        created_at=r[6],
                        metadata=r[7] if isinstance(r[7], dict) else json.loads(r[7] or "{}"),
                    )
                    for r in rows
                ]
