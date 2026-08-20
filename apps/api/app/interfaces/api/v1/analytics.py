"""
Endpoints de Analíticas y Telemetría Técnica de Synckre Agent V2.
"""

from fastapi import APIRouter, Depends
from app.infrastructure.db.manager import db_manager
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/analytics", tags=["Analytics"], dependencies=[Depends(require_internal_key)])


@router.get("/stats", summary="Obtener contadores agregados de telemetría de herramientas")
async def get_stats():
    stats = await db_manager.get_analytics_stats()
    return stats


@router.get("/metrics", summary="Endpoint de métricas en formato texto de Prometheus para Grafana")
async def get_prometheus_metrics():
    stats = await db_manager.get_analytics_stats() or {}
    total_exec = stats.get("total_executions", 0)
    avg_latency = stats.get("avg_execution_time_ms", 0.0)

    lines = [
        "# HELP synckre_tool_executions_total Número total de ejecuciones de herramientas",
        "# TYPE synckre_tool_executions_total counter",
        f"synckre_tool_executions_total {total_exec}",
        "# HELP synckre_tool_execution_latency_ms Latencia media de herramientas en ms",
        "# TYPE synckre_tool_execution_latency_ms gauge",
        f"synckre_tool_execution_latency_ms {avg_latency:.2f}",
    ]
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse("\n".join(lines), media_type="text/plain")

