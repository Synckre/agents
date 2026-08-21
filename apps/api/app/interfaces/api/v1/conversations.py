"""
Endpoints de Conversaciones para Synckre Agent V2.
Permite iniciar conversaciones, listar hilos, obtener historial y enviar mensajes al AgentRuntime.
"""

import asyncio
import json
import uuid
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.application.agent.runtime import agent_runtime
from app.application.services.event_bus import event_bus
from app.infrastructure.db.manager import db_manager
from app.domain import ChannelEnum, ConversationModel, MessageModel
from app.interfaces.limiter import limiter
from app.interfaces.security import (
    DomainRole,
    require_any_key,
    require_authenticated_user,
    require_internal_key,
    resolve_allowed_role,
)

router = APIRouter(prefix="/api/v1/conversations", tags=["Conversations"])


class UnifiedChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    role: Optional[str] = "contact_form_agent"
    user_id: Optional[str] = None
    customer_id: Optional[str] = None


@router.post("/chat", summary="Chat directo (Crea conversación si no existe e invoca AgentRuntime)")
@limiter.limit("30/minute")
async def chat_direct(request: Request, req: UnifiedChatRequest, _domain: DomainRole = Depends(require_any_key)):
    conv_id = req.conversation_id
    active_role = resolve_allowed_role(_domain, req.role)
    if _domain == "public":
        active_role = "contact_form_agent"

    if conv_id:
        conv = await db_manager.get_conversation(conv_id)
        if not conv:
            conv_id = None

    if not conv_id:
        conv_id = f"CONV-{uuid.uuid4().hex[:8]}"
        conv = ConversationModel(
            id=conv_id,
            channel=ChannelEnum.API,
            user_id=req.user_id,
            customer_id=req.customer_id,
            role=active_role,
        )
        await db_manager.create_conversation(conv)

    result = await agent_runtime.execute(
        conversation_id=conv_id,
        user_input=req.message,
        role_name=active_role,
        user_id=req.user_id,
        customer_id=req.customer_id,
    )

    resp_dict = result.to_dict()
    resp_dict["conversation_id"] = conv_id
    return resp_dict


@router.get("/{id}/events", summary="Stream SSE del progreso de la ejecución del agente")
async def conversation_events(id: str, _user: dict = Depends(require_authenticated_user)):
    queue = event_bus.subscribe(id)

    async def generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            event_bus.unsubscribe(id)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class CreateConversationRequest(BaseModel):
    role: str = "contact_form_agent"
    channel: str = "api"
    user_id: Optional[str] = None
    customer_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SendMessageRequest(BaseModel):
    message: str
    role: Optional[str] = None
    user_id: Optional[str] = None
    customer_id: Optional[str] = None
    as_human: Optional[bool] = False


@router.post("", summary="Crear o inicializar una Conversación")
@limiter.limit("30/minute")
async def create_conversation(request: Request, req: CreateConversationRequest, _domain: DomainRole = Depends(require_internal_key)):
    conv_id = f"CONV-{uuid.uuid4().hex[:8]}"
    conv = ConversationModel(
        id=conv_id,
        channel=ChannelEnum(req.channel) if req.channel in ChannelEnum.__members__ else ChannelEnum.API,
        user_id=req.user_id,
        customer_id=req.customer_id,
        role=resolve_allowed_role(_domain, req.role),
        metadata=req.metadata,
    )
    saved = await db_manager.create_conversation(conv)
    return saved.dict()


@router.get("", summary="Listar conversaciones activas", dependencies=[Depends(require_internal_key)])
async def list_conversations(limit: int = 50):
    conversations = await db_manager.list_conversations(limit=limit)
    return [c.dict() for c in conversations]


@router.get("/{id}", summary="Obtener detalles de una conversación e historial de mensajes", dependencies=[Depends(require_internal_key)])
async def get_conversation(id: str):
    conv = await db_manager.get_conversation(id)
    if not conv:
        raise HTTPException(status_code=404, detail=f"Conversación '{id}' no encontrada.")
    messages = await db_manager.get_messages(id)
    return {
        "conversation": conv.dict(),
        "messages": [m.dict() for m in messages],
    }


@router.delete("/{id}", summary="Eliminar una conversación y su historial de mensajes", dependencies=[Depends(require_internal_key)])
async def delete_conversation(id: str):
    deleted = await db_manager.delete_conversation(id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Conversación '{id}' no encontrada.")
    return {"status": "deleted", "conversation_id": id}


@router.post("/{id}/messages", summary="Enviar mensaje a una conversación e invocar AgentRuntime")
@limiter.limit("30/minute")
async def send_message(request: Request, id: str, req: SendMessageRequest, _domain: DomainRole = Depends(require_internal_key)):
    conv = await db_manager.get_conversation(id)
    if not conv:
        raise HTTPException(status_code=404, detail=f"Conversación '{id}' no encontrada.")

    # Modo operador humano: solo con sesión Clerk.
    if req.as_human:
        human_msg = MessageModel(
            id=f"MSG-{uuid.uuid4().hex[:8]}",
            conversation_id=id,
            sender="human",
            content=req.message,
        )
        await db_manager.add_message(human_msg)
        await db_manager.log_audit(
            agent_role="human_operator",
            action="human_message",
            user_id=req.user_id,
            task_id=None,
            input_summary=req.message[:200],
            output_summary=None,
            authorization_result="authorized",
        )
        return {
            "status": "success",
            "sender": "human",
            "conversation_id": id,
            "message": human_msg.dict(),
        }

    # Conversación bajo atención humana: el modelo NO responde.
    # El mensaje del cliente se registra y queda en cola para el operador.
    if conv.status == "paused_human":
        user_msg = MessageModel(
            id=f"MSG-{uuid.uuid4().hex[:8]}",
            conversation_id=id,
            sender="user",
            content=req.message,
        )
        await db_manager.add_message(user_msg)
        return {
            "status": "queued",
            "sender": "user",
            "conversation_id": id,
            "note": (
                "La conversación está siendo atendida por un operador humano. "
                "Tu mensaje ha sido registrado y un operador te responderá."
            ),
            "message": user_msg.dict(),
        }

    active_role = resolve_allowed_role(_domain, req.role or conv.role)

    result = await agent_runtime.execute(
        conversation_id=id,
        user_input=req.message,
        role_name=active_role,
        user_id=req.user_id,
        customer_id=req.customer_id,
    )

    return result.to_dict()
