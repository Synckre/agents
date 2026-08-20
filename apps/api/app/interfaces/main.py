"""
Aplicación Principal FastAPI para Synckre Agent V2.
Monta la API REST versionada (/api/v1) y gestiona el ciclo de vida del servicio.
"""

import json
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.interfaces.limiter import limiter
from app.interfaces.api.v1.approvals import router as approvals_router
from app.interfaces.api.v1.audit import router as audit_router
from app.interfaces.api.v1.business import router as business_router
from app.interfaces.api.v1.calendar import router as calendar_router
from app.interfaces.api.v1.conversations import router as conversations_router
from app.interfaces.api.v1.health import router as health_router
from app.interfaces.api.v1.knowledge import router as knowledge_router
from app.interfaces.api.v1.tasks import router as tasks_router
from app.interfaces.api.v1.analytics import router as analytics_router

# Importar tools para registro
import app.application.tools  # noqa: F401

from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.erp import erpnext_client
from app.application.services.reminder_scheduler import reminder_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("main_v2")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Iniciando Synckre Agent V2 Enterprise Runtime API.")
    try:
        await db_manager.connect()
    except Exception as exc:
        logger.warning("PostgreSQL no disponible al arrancar: %s", exc)
    await reminder_scheduler.start()
    yield
    await reminder_scheduler.stop()
    await db_manager.disconnect()
    await erpnext_client.aclose()


app = FastAPI(
    title="Synckre Agent V2 — Enterprise Agent Runtime",
    description=(
        "Plataforma empresarial de agentes autónomos para Synckre.\n"
        "Agent Runtime + Roles + Policies + Tools + Memory + RAG + Tasks + Temporal"
    ),
    version="2.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    """Log estructurado (una línea JSON) de cada petición HTTP."""
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(json.dumps({
            "event": "request_error",
            "method": request.method,
            "path": request.url.path,
        }))
        raise
    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(json.dumps({
        "event": "request",
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "duration_ms": duration_ms,
        "client": request.client.host if request.client else None,
    }, ensure_ascii=False))
    return response

# Montar Routers v1
app.include_router(health_router)
app.include_router(conversations_router)
app.include_router(tasks_router)
app.include_router(approvals_router)
app.include_router(business_router)
app.include_router(knowledge_router)
app.include_router(audit_router)
app.include_router(analytics_router)
app.include_router(calendar_router)


@app.get("/")
async def root():
    return {
        "platform": "Synckre Agent V2",
        "status": "online",
        "docs": "/docs",
        "health": "/api/v1/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
