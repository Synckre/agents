"""
Auth del Agent Runtime.

El Control Center se autentica con Clerk. Las rutas internas exigen un JWT
de *nuestro* issuer (no cualquier tenant Clerk). Las rutas públicas
(health, contacto, chat del sitio) no requieren sesión.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from http.cookies import SimpleCookie
from typing import Any, Dict, Literal, Optional
import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager

logger = logging.getLogger("security")

DomainRole = Literal["public", "internal", "admin"]

_jwks_clients: Dict[str, PyJWKClient] = {}


def _unauth() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado.")


def _issuer_from_publishable_key(pk: str) -> str:
    if not pk or not pk.startswith("pk_"):
        return ""
    parts = pk.split("_", 2)
    if len(parts) < 3:
        return ""
    raw = parts[2]
    pad = "=" * ((4 - len(raw) % 4) % 4)
    try:
        decoded = base64.urlsafe_b64decode(raw + pad).decode("utf-8")
    except Exception:
        return ""
    domain = decoded.split("$", 1)[0].strip()
    if not domain or "." not in domain:
        return ""
    return f"https://{domain}"


def configured_clerk_issuers() -> list[str]:
    issuers: list[str] = []
    if (settings.CLERK_ISSUER or "").strip():
        issuers.append(settings.CLERK_ISSUER.strip().rstrip("/"))
    derived = _issuer_from_publishable_key(settings.CLERK_PUBLISHABLE_KEY or "")
    if derived:
        issuers.append(derived)
    # únicos, orden estable
    return list(dict.fromkeys(issuers))


def _jwks_client(iss: str) -> PyJWKClient:
    base = iss.rstrip("/")
    client = _jwks_clients.get(base)
    if client is None:
        client = PyJWKClient(f"{base}/.well-known/jwks.json")
        _jwks_clients[base] = client
    return client


def _token_from_headers(
    authorization: Optional[str],
    cookie_header: Optional[str],
) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            return token
    if not cookie_header:
        return None
    parsed = SimpleCookie()
    try:
        parsed.load(cookie_header)
    except Exception:
        return None
    morsel = parsed.get("__session")
    if morsel and morsel.value:
        return morsel.value.strip()
    return None


def _azp_allowed(azp: str, issuers: list[str]) -> bool:
    if not azp:
        return True
    normalized = azp.rstrip("/")
    allowed = set(settings.clerk_authorized_parties_list)
    allowed.update(issuers)
    return normalized in allowed


def verify_clerk_token(token: str) -> Dict[str, Any]:
    issuers = configured_clerk_issuers()
    if not issuers:
        logger.warning("Clerk issuer no configurado: se rechaza el token.")
        raise _unauth()
    try:
        unverified = jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
        iss = str(unverified.get("iss") or "").rstrip("/")
        if iss not in issuers:
            raise _unauth()
        signing_key = _jwks_client(iss).get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=iss,
        )
    except HTTPException:
        raise
    except Exception:
        raise _unauth()
    if not payload.get("sub"):
        raise _unauth()
    azp = str(payload.get("azp") or "")
    if not _azp_allowed(azp, issuers):
        raise _unauth()
    return payload


def _api_key_from_bearer(authorization: Optional[str]) -> Optional[str]:
    """Grafana/Prometheus suelen mandar la API key como Authorization: Bearer sk_..."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if token.startswith("sk_"):
        return token
    return None


def _presented_api_key(authorization: Optional[str], x_api_key: Optional[str]) -> Optional[str]:
    raw = (x_api_key or "").strip() or _api_key_from_bearer(authorization)
    return raw or None


async def _api_key_is_active(raw_key: str) -> bool:
    key = (raw_key or "").strip()
    if not key:
        return False
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    row = await db_manager.fetch_one(
        """
        SELECT 1 AS ok FROM synckre.api_keys
        WHERE key_hash = %s AND is_active = TRUE
          AND (expires_at IS NULL OR expires_at > NOW())
        """,
        key_hash,
    )
    return bool(row)


async def require_authenticated_user(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    cookie: Optional[str] = Header(default=None, alias="Cookie"),
) -> Dict[str, Any]:
    token = _token_from_headers(authorization, cookie)
    if not token or token.startswith("sk_"):
        raise _unauth()
    return verify_clerk_token(token)


async def authenticate_request(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    cookie: Optional[str] = Header(default=None, alias="Cookie"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    presented = _presented_api_key(authorization, x_api_key)
    if presented and await _api_key_is_active(presented):
        return "admin"
    token = _token_from_headers(authorization, cookie)
    if not token or token.startswith("sk_"):
        return "public"
    verify_clerk_token(token)
    return "admin"


async def require_public_key(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    cookie: Optional[str] = Header(default=None, alias="Cookie"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    return await authenticate_request(authorization, cookie, x_api_key)


async def require_internal_key(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    cookie: Optional[str] = Header(default=None, alias="Cookie"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    presented = _presented_api_key(authorization, x_api_key)
    if presented:
        if await _api_key_is_active(presented):
            return "admin"
        raise _unauth()
    await require_authenticated_user(authorization, cookie)
    return "admin"


async def require_admin_key(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    cookie: Optional[str] = Header(default=None, alias="Cookie"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    return await require_internal_key(authorization, cookie, x_api_key)


async def require_any_key(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    cookie: Optional[str] = Header(default=None, alias="Cookie"),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> DomainRole:
    return await authenticate_request(authorization, cookie, x_api_key)


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
    """Resuelve el rol de agente. Anónimos (public) solo formulario de contacto."""
    if domain == "public":
        return "contact_form_agent"
    role = (requested_role or "contact_form_agent").strip() or "contact_form_agent"
    return role if role in ALL_ROLES else "contact_form_agent"
