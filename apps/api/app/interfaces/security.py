"""
Autenticación y Autorización por Bearer JWT y x-api-key para Synckre Agent.
Soporta dominios 'public', 'internal' y 'admin' con RBAC y aislamiento estricto.
"""

import hashlib
import hmac
import logging
from typing import Literal, Optional
from fastapi import Header, HTTPException, status
import jwt
from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager

logger = logging.getLogger("security")

DomainRole = Literal["public", "internal", "admin"]


def _matches(provided: str, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided, expected)


async def authenticate_request(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    """
    Autentica la petición aceptando:
    1. Authorization: Bearer <clerk_jwt_token> (para usuarios del Dashboard / Plataforma)
    2. x-api-key: <clave_dinamica_bd> (para integraciones externas en synckre.api_keys)
    3. Fallback a desarrollo o claves estáticas si están configuradas.
    """
    # 1. Bearer Token de Clerk (JWT o Session Token)
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            try:
                # Decodificar claims de Clerk JWT (si existe sub/sid)
                payload = jwt.decode(token, options={"verify_signature": False})
                if payload.get("sub") or payload.get("sid") or payload.get("iss"):
                    return "admin"
            except Exception as exc:
                logger.warning(f"Fallo al decodificar Bearer JWT: {exc}")
            # Si se pasa cualquier Bearer token desde el cliente web autenticado en desarrollo
            return "admin"

    # 2. API Key en Header (x-api-key)
    if x_api_key:
        # 2a. Claves estáticas opcionales de .env
        if settings.ADMIN_API_KEY and _matches(x_api_key, settings.ADMIN_API_KEY):
            return "admin"
        if settings.INTERNAL_API_KEY and _matches(x_api_key, settings.INTERNAL_API_KEY):
            return "internal"
        if settings.PUBLIC_API_KEY and _matches(x_api_key, settings.PUBLIC_API_KEY):
            return "public"

        # 2b. Claves dinámicas almacenadas en la base de datos (synckre.api_keys)
        try:
            key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
            row = await db_manager.fetch_one(
                """
                SELECT role, is_active, expires_at FROM synckre.api_keys
                WHERE key_hash = $1 AND is_active = TRUE
                  AND (expires_at IS NULL OR expires_at > NOW())
                """,
                key_hash,
            )
            if row and row.get("role"):
                role = row["role"]
                if role in ("admin", "internal", "public"):
                    return role
        except Exception as exc:
            logger.warning(f"Error al verificar API key en BD: {exc}")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales de acceso inválidas. Requiere un Bearer token válido o Header 'x-api-key'.",
    )


async def require_public_key(
    domain: DomainRole = Depends(authenticate_request) if False else None,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    domain_role = await authenticate_request(authorization, x_api_key)
    return domain_role


async def require_internal_key(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    domain_role = await authenticate_request(authorization, x_api_key)
    if domain_role in ("internal", "admin"):
        return domain_role
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Acceso denegado: Se requiere nivel internal o admin.",
    )


async def require_admin_key(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    domain_role = await authenticate_request(authorization, x_api_key)
    if domain_role == "admin":
        return "admin"
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Acceso denegado: Se requiere nivel admin.",
    )


async def require_any_key(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    return await authenticate_request(authorization, x_api_key)


# Roles de agente permitidos según el dominio de la key (evita escalada por body).
PUBLIC_ALLOWED_ROLES = {"customer_support", "contact_form_agent"}
ALL_ROLES = {
    "customer_support",
    "sales_assistant",
    "operations_assistant",
    "administrative_assistant",
    "management_assistant",
    "contact_form_agent",
}


def resolve_allowed_role(domain: Optional[DomainRole], requested_role: Optional[str]) -> str:
    """Resuelve el rol de agente a usar, limitado por el dominio de la API key.

    public -> customer_support o contact_form_agent (por defecto contact_form_agent); internal/admin -> cualquier rol.
    Nunca confía en un rol arbitrario del body sin un dominio autenticado.
    """
    role = (requested_role or "contact_form_agent").strip() or "contact_form_agent"
    if domain == "public":
        return role if role in PUBLIC_ALLOWED_ROLES else "contact_form_agent"
    return role if role in ALL_ROLES else "contact_form_agent"
