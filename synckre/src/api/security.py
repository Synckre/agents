"""Seguridad de la API.

- Autenticación por API key (header X-API-Key) con secrets.compare_digest.
- Rate limiting con slowapi, limitado por API key (no por IP, por estar tras proxy).
- CORS restringido a whitelist, TrustedHost, headers de seguridad y límite de body.
- El detalle de errores internos se loguea server-side; al cliente solo va un
  mensaje neutro (ver exception handlers en main.py).
"""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import Depends, HTTPException, Request, Response, status
from slowapi import Limiter
from starlette.datastructures import MutableHeaders

from api.settings import Settings, get_settings

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "no-referrer",
}


def _api_key_identifier(request: Request) -> str:
    """Identificador para rate limiting: la API key (nunca la IP, hay proxy delante)."""
    return request.headers.get("X-API-Key", "anonymous")


def create_limiter(settings: Settings) -> Limiter:
    """Crea el limiter de slowapi con el límite configurado por env var."""
    return Limiter(
        key_func=_api_key_identifier,
        default_limits=[settings.rate_limit],
        storage_uri="memory://",
    )


def require_api_key(
    request: Request, settings: Settings = Depends(get_settings)
) -> None:
    """Dependencia de autenticación: valida X-API-Key con comparación constante."""
    provided = request.headers.get("X-API-Key")
    if not provided or not settings.api_keys:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="API key requerida")
    for key in settings.api_keys:
        # compare_digest: evita timing attacks (nunca usar ==).
        if secrets.compare_digest(provided.encode("utf-8"), key.encode("utf-8")):
            return
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="API key inválida")


class BodyLimitExceeded(Exception):
    """Se lanza internamente cuando el body supera el límite configurado."""


class SecurityHeadersMiddleware:
    """Añade headers de seguridad a todas las respuestas HTTP."""

    def __init__(self, app: Any) -> None:
        """Envuelve la app ASGI."""
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        """Añade los headers de seguridad a cada respuesta HTTP."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in _SECURITY_HEADERS.items():
                    headers.append(name, value)
            await send(message)

        await self.app(scope, receive, send_wrapper)


class BodySizeLimitMiddleware:
    """Rechaza (413) requests cuyo body supere max_bytes, incluso con chunked encoding."""

    def __init__(self, app: Any, max_bytes: int) -> None:
        """Guarda la app y el límite de bytes."""
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        """Rechaza con 413 los bodies que superen el límite."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_length = 0
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                content_length = int(value)
        if content_length > self.max_bytes:
            await self._reject(scope, receive, send)
            return

        received = 0

        async def wrapped_receive() -> Any:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyLimitExceeded()
            return message

        try:
            await self.app(scope, wrapped_receive, send)
        except BodyLimitExceeded:
            await self._reject(scope, receive, send)

    @staticmethod
    async def _reject(scope: Any, receive: Any, send: Any) -> None:
        response = Response(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            content="Payload demasiado grande",
        )
        await response(scope, receive, send)


def rate_limit_handler(request: Request, exc: Exception) -> Response:
    """Responde 429 neutro al exceder el rate limit."""
    return Response(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content='{"detalle": "Demasiadas solicitudes. Inténtalo más tarde."}',
        media_type="application/json",
    )
