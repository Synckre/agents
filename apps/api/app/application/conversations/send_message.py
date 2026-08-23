"""Casos de uso de chat. Los routers no tocan SQL."""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from app.application.agent.runtime import agent_runtime
from app.domain import ChannelEnum, ConversationModel, MessageModel
from app.infrastructure.db.manager import db_manager
from app.application.auth import Principal, resolve_allowed_role


async def start_chat(
    *,
    message: str,
    principal: Principal,
    conversation_id: Optional[str] = None,
    role: Optional[str] = None,
    user_id: Optional[str] = None,
    customer_id: Optional[str] = None,
) -> Dict[str, Any]:
    conv_id = conversation_id
    active_role = resolve_allowed_role(principal, role)
    if conv_id:
        conv = await db_manager.conversations.get(conv_id)
        if not conv:
            conv_id = None
    if not conv_id:
        conv_id = f"CONV-{uuid.uuid4().hex[:8]}"
        await db_manager.conversations.create(
            ConversationModel(
                id=conv_id,
                channel=ChannelEnum.API,
                user_id=user_id,
                customer_id=customer_id,
                role=active_role,
            )
        )
    result = await agent_runtime.execute(
        conversation_id=conv_id,
        user_input=message,
        role_name=active_role,
        user_id=user_id,
        customer_id=customer_id,
    )
    payload = result.to_dict()
    payload["conversation_id"] = conv_id
    return payload


async def send_message(
    *,
    conversation_id: str,
    message: str,
    principal: Principal,
    role: Optional[str] = None,
    user_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    as_human: bool = False,
) -> Dict[str, Any]:
    conv = await db_manager.conversations.get(conversation_id)
    if not conv:
        return {"error": "not_found", "conversation_id": conversation_id}

    if as_human:
        human_msg = MessageModel(
            id=f"MSG-{uuid.uuid4().hex[:8]}",
            conversation_id=conversation_id,
            sender="human",
            content=message,
        )
        await db_manager.conversations.add_message(human_msg)
        await db_manager.telemetry.log_audit(
            agent_role="human_operator",
            action="human_message",
            user_id=user_id,
            authorization_result="authorized",
        )
        return {
            "status": "success",
            "sender": "human",
            "conversation_id": conversation_id,
            "message": human_msg.dict(),
        }

    if conv.status == "paused_human":
        user_msg = MessageModel(
            id=f"MSG-{uuid.uuid4().hex[:8]}",
            conversation_id=conversation_id,
            sender="user",
            content=message,
        )
        await db_manager.conversations.add_message(user_msg)
        return {
            "status": "queued",
            "sender": "user",
            "conversation_id": conversation_id,
            "note": (
                "La conversación está siendo atendida por un operador humano. "
                "Tu mensaje ha sido registrado y un operador te responderá."
            ),
            "message": user_msg.dict(),
        }

    active_role = resolve_allowed_role(principal, role or conv.role)
    result = await agent_runtime.execute(
        conversation_id=conversation_id,
        user_input=message,
        role_name=active_role,
        user_id=user_id,
        customer_id=customer_id,
    )
    return result.to_dict()
