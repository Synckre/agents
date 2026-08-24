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
        elif (conv.metadata or {}).get("resume_token") and conv.role == "sales_assistant":
            active_role = "sales_assistant"
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
    if getattr(principal, "is_anonymous", False):
        from app.application.agent.company_scope import idioma_contacto
        from app.application.public_limits import CHAT_MAX_TURNS

        try:
            existentes = await db_manager.get_messages(conv_id, limit=200)
        except Exception:
            existentes = []
        user_turns = sum(1 for m in existentes if getattr(m, "sender", None) == "user")
        if user_turns >= CHAT_MAX_TURNS:
            lang = await idioma_contacto(conv_id, message)
            reply = (
                "We've reached the limit for this chat. A Synckre specialist can follow up — "
                "or start a new request later."
                if lang == "en"
                else (
                    "Hemos llegado al límite de este chat. Un especialista de Synckre puede continuar, "
                    "o puedes iniciar otra consulta más adelante."
                )
            )
            return {
                "response": reply,
                "conversation_id": conv_id,
                "role": active_role,
                "tool_calls": [],
                "limited": True,
            }
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


async def continue_by_token(*, token: str, message: str) -> Dict[str, Any]:
    """Retoma el hilo público con el cualificador (sales_assistant)."""
    from app.application.public_limits import FOLLOW_UP_ROLE

    token = (token or "").strip()
    if not token:
        return {"error": "invalid_token"}
    conv = await db_manager.get_conversation_by_resume_token(token)
    if not conv:
        return {"error": "invalid_token"}
    if conv.status == "paused_human":
        return {"error": "paused", "conversation_id": conv.id}
    if conv.role != FOLLOW_UP_ROLE:
        await db_manager.update_conversation_role(conv.id, FOLLOW_UP_ROLE)
    result = await agent_runtime.execute(
        conversation_id=conv.id,
        user_input=message,
        role_name=FOLLOW_UP_ROLE,
    )
    payload = result.to_dict()
    payload["conversation_id"] = conv.id
    payload["role"] = FOLLOW_UP_ROLE
    return payload
