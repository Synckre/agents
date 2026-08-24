from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from app.application.conversations.send_message import continue_by_token
from app.application.public_limits import CHAT_PER_HOUR, CHAT_PER_MINUTE, CONTACT_PER_HOUR, CONTACT_PER_MINUTE
from app.infrastructure.db.manager import db_manager
from app.interfaces.limiter import limiter
from app.interfaces.security import require_internal_key
from app.infrastructure.tools.crm_tools import guardar_lead

router = APIRouter(tags=["Business Entities"])


class PublicContinueRequest(BaseModel):
    token: str
    message: str


class PublicContactRequest(BaseModel):
    name: str
    email: str
    company: Optional[str] = ""
    phone: Optional[str] = ""
    service: Optional[str] = ""
    message: str


@router.post("/api/v1/public/contact", summary="Recibir mensaje de contacto público desde el sitio web")
@limiter.limit(f"{CONTACT_PER_MINUTE}/minute")
@limiter.limit(f"{CONTACT_PER_HOUR}/hour")
async def public_contact(request: Request, req: PublicContactRequest):
    if not req.name.strip() or not req.email.strip() or not req.message.strip():
        raise HTTPException(status_code=400, detail="Los campos 'name', 'email' y 'message' son obligatorios.")

    from app.application.agent.company_scope import idioma_contacto

    full_message = f"[Servicio de interés: {req.service}] {req.message}" if req.service else req.message
    idioma = await idioma_contacto(None, req.message)
    res = await guardar_lead(
        nombre=req.name,
        email=req.email,
        empresa=req.company or "",
        telefono=req.phone or "",
        mensaje=full_message,
        origen="website_contact_form",
        idioma_cliente=idioma,
    )
    return {
        "status": "success",
        "message": "Contacto recibido exitosamente.",
        "details": res,
    }


@router.get("/api/v1/public/continue", summary="Retomar conversación con el cualificador (token del correo)")
@limiter.limit(f"{CHAT_PER_MINUTE}/minute")
async def public_continue_get(request: Request, token: str):
    conv = await db_manager.get_conversation_by_resume_token(token)
    if not conv:
        raise HTTPException(status_code=404, detail="Enlace inválido o caducado.")
    msgs = await db_manager.get_messages(conv.id, limit=40)
    return {
        "conversation_id": conv.id,
        "role": conv.role,
        "status": conv.status,
        "messages": [
            {"sender": m.sender, "content": m.content, "created_at": m.created_at.isoformat() if m.created_at else None}
            for m in msgs
        ],
    }


@router.post("/api/v1/public/continue", summary="Enviar mensaje en la conversación de seguimiento")
@limiter.limit(f"{CHAT_PER_MINUTE}/minute")
@limiter.limit(f"{CHAT_PER_HOUR}/hour")
async def public_continue_post(request: Request, req: PublicContinueRequest):
    payload = await continue_by_token(token=req.token, message=req.message)
    if payload.get("error") == "invalid_token":
        raise HTTPException(status_code=404, detail="Enlace inválido o caducado.")
    if payload.get("error") == "paused":
        raise HTTPException(status_code=409, detail="La conversación está en atención humana.")
    return payload


@router.get("/api/v1/customers", summary="Listar clientes registrados", dependencies=[Depends(require_internal_key)])
async def list_customers():
    # Retorna lista de clientes
    return []


@router.get("/api/v1/leads", summary="Listar leads registrados", dependencies=[Depends(require_internal_key)])
async def list_leads(limit: int = 50):
    # Los leads se registran en synckre.memory (entity_type='lead')
    return await db_manager.list_leads(limit=limit)


@router.get("/api/v1/contracts", summary="Listar contratos", dependencies=[Depends(require_internal_key)])
async def list_contracts():
    sql = """
    SELECT id, customer_id, title, status, template_name, content, created_by, created_at, updated_at
    FROM synckre.contracts
    ORDER BY created_at DESC
    LIMIT 50;
    """
    if not await db_manager._ensure_connected():
        return []
    async with db_manager.pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql)
            rows = await cur.fetchall()
            return [
                {
                    "id": r[0],
                    "customer_id": r[1],
                    "title": r[2],
                    "status": r[3],
                    "template_name": r[4],
                    "content": r[5],
                    "created_by": r[6],
                    "created_at": r[7].isoformat() if r[7] else None,
                    "updated_at": r[8].isoformat() if r[8] else None,
                }
                for r in rows
            ]
