from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.infrastructure.db.manager import db_manager
from app.interfaces.security import require_any_key, require_internal_key
from app.application.tools.crm_tools import guardar_lead

router = APIRouter(tags=["Business Entities"])


class PublicContactRequest(BaseModel):
    name: str
    email: str
    company: Optional[str] = ""
    phone: Optional[str] = ""
    service: Optional[str] = ""
    message: str


@router.post("/api/v1/public/contact", summary="Recibir mensaje de contacto público desde el sitio web", dependencies=[Depends(require_any_key)])
async def public_contact(req: PublicContactRequest):
    if not req.name.strip() or not req.email.strip() or not req.message.strip():
        raise HTTPException(status_code=400, detail="Los campos 'name', 'email' y 'message' son obligatorios.")

    full_message = f"[Servicio de interés: {req.service}] {req.message}" if req.service else req.message
    res = await guardar_lead(
        nombre=req.name,
        email=req.email,
        empresa=req.company or "",
        telefono=req.phone or "",
        mensaje=full_message,
        origen="website_contact_form",
    )
    return {
        "status": "success",
        "message": "Contacto recibido exitosamente.",
        "details": res,
    }


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
