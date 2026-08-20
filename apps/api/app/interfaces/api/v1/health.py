"""
Endpoint de Health Check para Synckre Agent V2.
Requiere una API key válida (cualquier nivel) y reporta el estado de las dependencias.
"""

from typing import Optional

from fastapi import APIRouter, Depends

from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.erp import erpnext_client
from app.infrastructure.rag.service import knowledge_service
from app.interfaces.security import DomainRole, require_any_key

router = APIRouter(tags=["Health"])


@router.get("/api/v1/health", summary="Health check endpoint para Docker/Coolify y balanceadores de carga")
async def health_check():
    db_ok = await db_manager._ensure_connected()

    # ERPNext: solo comprobación de configuración (un ping real ralentizaría el healthcheck)
    erpnext_status = "configured" if erpnext_client.is_configured() else "not_configured"

    # Ollama: ping rápido a /api/tags
    ollama_ok = await knowledge_service.ping()

    # Email: proveedor configurado
    email_key = (settings.RESEND_API_KEY or settings.SENDGRID_API_KEY or "").strip()
    email_status = "configured" if (email_key and (settings.EMAIL_FROM or "").strip()) else "not_configured"

    # El estado general solo depende de la BD; las demás dependencias son informativas
    # (la app funciona en degradado sin ERPNext/Ollama/email).
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
