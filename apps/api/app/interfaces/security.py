"""
Autenticación y Autorización por x-api-key para Synckre Agent V2.
Soporta dominios 'public', 'internal' y 'admin' con RBAC y aislamiento estricto.
"""

import hmac
import logging
from typing import Literal, Optional
from fastapi import Header, HTTPException, status
from app.infrastructure.config import settings

logger = logging.getLogger("security")

DomainRole = Literal["public", "internal", "admin"]


def _matches(provided: str, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided, expected)


def resolve_domain(api_key: Optional[str]) -> Optional[DomainRole]:
    if not api_key:
        return None
    if _matches(api_key, settings.ADMIN_API_KEY):
        return "admin"
    if _matches(api_key, settings.INTERNAL_API_KEY):
        return "internal"
    if _matches(api_key, settings.PUBLIC_API_KEY):
        return "public"
    return None


def require_domain(expected: DomainRole, x_api_key: Optional[str]) -> DomainRole:
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header 'x-api-key' ausente.",
        )
    actual = resolve_domain(x_api_key)
    if actual is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key inválida.",
        )

    # Admin puede acceder a cualquier endpoint
    if actual == "admin":
        return "admin"

    if actual != expected:
        logger.warning(f"Intento de acceso cruzado: Clave '{actual}' intentó acceder a '{expected}'")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Acceso denegado: El nivel '{actual}' no tiene autorización para '{expected}'.",
        )
    return actual


async def require_public_key(x_api_key: Optional[str] = Header(default=None, alias="x-api-key")) -> DomainRole:
    return require_domain("public", x_api_key)


async def require_internal_key(x_api_key: Optional[str] = Header(default=None, alias="x-api-key")) -> DomainRole:
    return require_domain("internal", x_api_key)


async def require_admin_key(x_api_key: Optional[str] = Header(default=None, alias="x-api-key")) -> DomainRole:
    return require_domain("admin", x_api_key)


async def require_any_key(x_api_key: Optional[str] = Header(default=None, alias="x-api-key")) -> DomainRole:
    """Valida que la key sea conocida (public/internal/admin) y devuelve su dominio."""
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header 'x-api-key' ausente.",
        )
    actual = resolve_domain(x_api_key)
    if actual is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key inválida.",
        )
    return actual


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
