"""
Endpoints de Analíticas y Telemetría Técnica de Synckre Agent V2.
Sin contenido conversacional: solo contadores, latencias y estados.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from app.infrastructure.db.manager import db_manager
from app.infrastructure.metrics_export import render_prometheus
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/analytics", tags=["Analytics"], dependencies=[Depends(require_internal_key)])


@router.get("/stats", summary="Contadores agregados de comportamiento del agente")
async def get_stats():
    return await db_manager.get_analytics_stats()


@router.get("/metrics", summary="Métricas Prometheus para Grafana (sin texto de conversación)")
async def get_prometheus_metrics():
    stats = await db_manager.get_analytics_stats() or {}
    series = await db_manager.get_observability_series()
    body = render_prometheus(series, stats)
    return PlainTextResponse(body, media_type="text/plain; version=0.0.4; charset=utf-8")
