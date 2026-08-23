"""CRUD de conversaciones para el Control Center."""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from app.application.auth import Principal, resolve_allowed_role
from app.domain import ChannelEnum, ConversationModel
from app.infrastructure.db.manager import db_manager


async def create_conversation(
    *,
    principal: Principal,
    role: str,
    channel: str = "api",
    user_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    conv_id = f"CONV-{uuid.uuid4().hex[:8]}"
    conv = ConversationModel(
        id=conv_id,
        channel=ChannelEnum(channel) if channel in ChannelEnum.__members__ else ChannelEnum.API,
        user_id=user_id,
        customer_id=customer_id,
        role=resolve_allowed_role(principal, role),
        metadata=metadata or {},
    )
    saved = await db_manager.conversations.create(conv)
    return saved.dict()


async def list_conversations(limit: int = 50):
    return [c.dict() for c in await db_manager.conversations.list(limit=limit)]


async def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    conv = await db_manager.conversations.get(conversation_id)
    if not conv:
        return None
    messages = await db_manager.conversations.get_messages(conversation_id)
    return {"conversation": conv.dict(), "messages": [m.dict() for m in messages]}


async def delete_conversation(conversation_id: str) -> bool:
    return await db_manager.conversations.delete(conversation_id)
