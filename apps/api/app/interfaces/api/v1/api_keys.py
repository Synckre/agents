"""
Endpoints de Gestión de API Keys para Synckre Agent V2.
Permite generar, listar y revocar API keys desde la plataforma.
"""

import hashlib
import secrets
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.infrastructure.db.manager import db_manager
from app.interfaces.security import require_internal_key, DomainRole

router = APIRouter(prefix="/api/v1/api-keys", tags=["API Keys"])


class CreateApiKeyRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Nombre de la integración o aplicación externa")
    role: str = Field(default="public", description="Rol de la API key (por defecto 'public' para integraciones externas)")


class ApiKeyResponse(BaseModel):
    id: str
    name: str
    prefix: str
    role: str
    is_active: bool
    created_at: str
    raw_key: Optional[str] = None  # Solo se retorna una vez al crear


@router.get("", response_model=List[ApiKeyResponse], summary="Listar API keys activas y revocadas")
async def list_api_keys(domain: DomainRole = Depends(require_internal_key)):
    rows = await db_manager.fetch_all(
        """
        SELECT id, name, prefix, role, is_active, created_at
        FROM synckre.api_keys
        ORDER BY created_at DESC
        """
    )
    res = []
    for r in rows:
        created_str = r["created_at"].isoformat() if r.get("created_at") else ""
        res.append(
            ApiKeyResponse(
                id=r["id"],
                name=r["name"],
                prefix=r["prefix"],
                role=r["role"],
                is_active=r["is_active"],
                created_at=created_str,
            )
        )
    return res


@router.post("", response_model=ApiKeyResponse, status_code=status.HTTP_201_CREATED, summary="Generar una nueva API Key")
async def create_api_key(
    req: CreateApiKeyRequest,
    domain: DomainRole = Depends(require_internal_key)
):
    if req.role not in ("public", "internal", "admin"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rol inválido. Debe ser 'public', 'internal' o 'admin'."
        )

    key_id = f"key_{uuid.uuid4().hex[:12]}"
    secret = secrets.token_urlsafe(32)
    raw_key = f"sk_{req.role}_{secret}"
    prefix = raw_key[:10]
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    row = await db_manager.fetch_one(
        """
        INSERT INTO synckre.api_keys (id, name, key_hash, prefix, role, is_active)
        VALUES (%s, %s, %s, %s, %s, TRUE)
        RETURNING id, name, prefix, role, is_active, created_at
        """,
        key_id,
        req.name.strip(),
        key_hash,
        prefix,
        req.role,
    )

    created_str = row["created_at"].isoformat() if row and row.get("created_at") else ""
    return ApiKeyResponse(
        id=row["id"],
        name=row["name"],
        prefix=row["prefix"],
        role=row["role"],
        is_active=row["is_active"],
        created_at=created_str,
        raw_key=raw_key,
    )


@router.delete("/{key_id}", status_code=status.HTTP_200_OK, summary="Revocar una API Key")
async def revoke_api_key(
    key_id: str,
    domain: DomainRole = Depends(require_internal_key)
):
    row = await db_manager.fetch_one(
        """
        UPDATE synckre.api_keys
        SET is_active = FALSE
        WHERE id = %s
        RETURNING id
        """,
        key_id,
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key no encontrada."
        )
    return {"status": "success", "message": "API key revocada correctamente."}
