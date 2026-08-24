"""
Endpoints de Conversaciones para Synckre Agent V2.
"""

import asyncio
import json
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.application.conversations import send_message as send_message_uc
from app.application.conversations import start_chat
from app.application.conversations import catalog
from app.application.services.event_bus import event_bus
from app.application.public_limits import CHAT_PER_DAY, CHAT_PER_HOUR, CHAT_PER_MINUTE
from app.interfaces.limiter import limiter
from app.interfaces.security import (
    Principal,
    require_any_key,
    require_authenticated_user,
    require_internal_key,
)

router = APIRouter(prefix="/api/v1/conversations", tags=["Conversations"])


class UnifiedChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    role: Optional[str] = "contact_form_agent"
    user_id: Optional[str] = None
    customer_id: Optional[str] = None


@router.post("/chat", summary="Chat directo (Crea conversación si no existe e invoca AgentRuntime)")
@limiter.limit(f"{CHAT_PER_MINUTE}/minute")
@limiter.limit(f"{CHAT_PER_HOUR}/hour")
@limiter.limit(f"{CHAT_PER_DAY}/day")
async def chat_direct(request: Request, req: UnifiedChatRequest, principal: Principal = Depends(require_any_key)):
    return await start_chat(
        message=req.message,
        principal=principal,
        conversation_id=req.conversation_id,
        role=req.role,
        user_id=req.user_id,
        customer_id=req.customer_id,
    )


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
async def create_conversation(request: Request, req: CreateConversationRequest, principal: Principal = Depends(require_internal_key)):
    return await catalog.create_conversation(
        principal=principal,
        role=req.role,
        channel=req.channel,
        user_id=req.user_id,
        customer_id=req.customer_id,
        metadata=req.metadata,
    )


@router.get("", summary="Listar conversaciones activas", dependencies=[Depends(require_internal_key)])
async def list_conversations(limit: int = 50):
    return await catalog.list_conversations(limit=limit)


@router.get("/{id}", summary="Obtener detalles de una conversación e historial de mensajes", dependencies=[Depends(require_internal_key)])
async def get_conversation(id: str):
    data = await catalog.get_conversation(id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Conversación '{id}' no encontrada.")
    return data


@router.delete("/{id}", summary="Eliminar una conversación y su historial de mensajes", dependencies=[Depends(require_internal_key)])
async def delete_conversation(id: str):
    deleted = await catalog.delete_conversation(id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Conversación '{id}' no encontrada.")
    return {"status": "deleted", "conversation_id": id}


@router.post("/{id}/messages", summary="Enviar mensaje a una conversación e invocar AgentRuntime")
@limiter.limit("30/minute")
async def send_message(request: Request, id: str, req: SendMessageRequest, principal: Principal = Depends(require_internal_key)):
    payload = await send_message_uc(
        conversation_id=id,
        message=req.message,
        principal=principal,
        role=req.role,
        user_id=req.user_id,
        customer_id=req.customer_id,
        as_human=bool(req.as_human),
    )
    if payload.get("error") == "not_found":
        raise HTTPException(status_code=404, detail=f"Conversación '{id}' no encontrada.")
    return payload
