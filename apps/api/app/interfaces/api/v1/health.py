"""
Endpoint de Health Check para Synckre Agent V2.
Público (sin API key): Docker/Coolify/Traefik lo usan para liveness.
Siempre responde 200 si el proceso está vivo; el JSON indica degradación.
"""

import asyncio

from fastapi import APIRouter

from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.erp import erpnext_client
from app.infrastructure.rag.service import knowledge_service

router = APIRouter(tags=["Health"])


async def _ping_postgres() -> bool:
    """SELECT 1 rápido. No reconecta (reconnect en health tumba Traefik por timeout)."""
    pool = db_manager.pool
    if pool is None or pool.closed:
        return False
    try:
        async with asyncio.timeout(1.5):
            async with pool.connection() as conn:
                await conn.execute("SELECT 1")
        return True
    except Exception:
        return False


@router.get("/api/v1/health", summary="Health check endpoint para Docker/Coolify y balanceadores de carga")
async def health_check():
    db_ok = await _ping_postgres()

    # ERPNext: solo comprobación de configuración (un ping real ralentizaría el healthcheck)
    erpnext_status = "configured" if erpnext_client.is_configured() else "not_configured"

    try:
        async with asyncio.timeout(1.5):
            ollama_ok = await knowledge_service.ping()
    except Exception:
        ollama_ok = False

    # Email: proveedor configurado
    email_key = (settings.RESEND_API_KEY or settings.SENDGRID_API_KEY or "").strip()
    email_status = "configured" if (email_key and (settings.EMAIL_FROM or "").strip()) else "not_configured"

    # HTTP 200 siempre: si devolvemos 5xx, Coolify/Traefik sacan el contenedor
    # de rotación y el navegador ve CORS (el 503 del proxy no lleva Allow-Origin).
    return {
        "status": "healthy" if db_ok else "degraded",
        "service": "Synckre Agent Runtime API",
        "version": "2.0.0",
        "company": settings.COMPANY_NAME,
        "database_connected": db_ok,
        "dependencies": {
            "postgresql": "ok" if db_ok else "down",
            "erpnext": erpnext_status,
            "ollama": "ok" if ollama_ok else "unreachable",
            "email": email_status,
        },
    }
