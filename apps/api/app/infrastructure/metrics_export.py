"""
Exportación Prometheus de telemetría técnica del agente.

Solo contadores y latencias. Nunca incluye texto de mensajes ni payloads de tools.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Sequence

_LABEL_RE = re.compile(r"[^a-zA-Z0-9_.:-]+")


def prometheus_label(value: Any, max_len: int = 64) -> str:
    cleaned = _LABEL_RE.sub("_", str(value if value is not None else "unknown")).strip("._")
    if not cleaned:
        return "unknown"
    return cleaned[:max_len]


def _labels(pairs: Mapping[str, Any]) -> str:
    inner = ",".join(f'{key}="{prometheus_label(val)}"' for key, val in pairs.items())
    return f"{{{inner}}}" if inner else ""


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value is not None else default)
    except (TypeError, ValueError):
        return default


def _metric_block(
    name: str,
    help_text: str,
    metric_type: str,
    rows: Iterable[Mapping[str, Any]],
    *,
    value_key: str,
    label_keys: Sequence[str] = (),
) -> List[str]:
    lines = [
        f"# HELP {name} {help_text}",
        f"# TYPE {name} {metric_type}",
    ]
    emitted = False
    for row in rows:
        labels = {key: row.get(key) for key in label_keys}
        lines.append(f"{name}{_labels(labels)} {_num(row.get(value_key)):.6g}")
        emitted = True
    if not emitted and not label_keys:
        lines.append(f"{name} 0")
    return lines


def render_prometheus(series: Dict[str, List[Dict[str, Any]]], stats: Dict[str, Any] | None = None) -> str:
    stats = stats or {}
    blocks: List[List[str]] = [
        _metric_block(
            "synckre_agent_runs_total",
            "Ejecuciones del Agent Runtime por rol, resultado y canal",
            "counter",
            series.get("agent_runs") or [],
            value_key="count",
            label_keys=("role", "outcome", "channel"),
        ),
        _metric_block(
            "synckre_agent_run_duration_ms_avg",
            "Duración media de una pasada del agente en ms",
            "gauge",
            series.get("run_latency") or [],
            value_key="avg_ms",
            label_keys=("role",),
        ),
        _metric_block(
            "synckre_agent_run_duration_ms_p50",
            "Percentil 50 de duración de una pasada del agente en ms",
            "gauge",
            series.get("run_latency") or [],
            value_key="p50_ms",
            label_keys=("role",),
        ),
        _metric_block(
            "synckre_agent_run_duration_ms_p95",
            "Percentil 95 de duración de una pasada del agente en ms",
            "gauge",
            series.get("run_latency") or [],
            value_key="p95_ms",
            label_keys=("role",),
        ),
        _metric_block(
            "synckre_llm_calls_total",
            "Llamadas al LLM por fase y estado",
            "counter",
            series.get("llm_calls") or [],
            value_key="count",
            label_keys=("phase", "status"),
        ),
        _metric_block(
            "synckre_llm_latency_ms_avg",
            "Latencia media de llamadas al LLM en ms",
            "gauge",
            series.get("llm_calls") or [],
            value_key="avg_ms",
            label_keys=("phase", "status"),
        ),
        _metric_block(
            "synckre_llm_prompt_tokens_total",
            "Tokens de prompt enviados al LLM",
            "counter",
            series.get("llm_calls") or [],
            value_key="prompt_tokens",
            label_keys=("phase", "status"),
        ),
        _metric_block(
            "synckre_llm_completion_tokens_total",
            "Tokens de completion generados por el LLM",
            "counter",
            series.get("llm_calls") or [],
            value_key="completion_tokens",
            label_keys=("phase", "status"),
        ),
        _metric_block(
            "synckre_tool_executions_total",
            "Ejecuciones de herramientas por nombre y estado",
            "counter",
            series.get("tools") or [],
            value_key="count",
            label_keys=("tool", "status"),
        ),
        _metric_block(
            "synckre_tool_latency_ms_avg",
            "Latencia media de herramientas en ms",
            "gauge",
            series.get("tools") or [],
            value_key="avg_ms",
            label_keys=("tool", "status"),
        ),
        _metric_block(
            "synckre_conversations",
            "Conversaciones abiertas o históricas por estado, rol y canal (sin contenido)",
            "gauge",
            series.get("conversations") or [],
            value_key="count",
            label_keys=("status", "role", "channel"),
        ),
        _metric_block(
            "synckre_messages_total",
            "Mensajes por emisor (user/agent/human). Sin texto.",
            "counter",
            series.get("messages") or [],
            value_key="count",
            label_keys=("sender",),
        ),
        _metric_block(
            "synckre_tasks",
            "Tareas del runtime por estado y tipo",
            "gauge",
            series.get("tasks") or [],
            value_key="count",
            label_keys=("status", "type"),
        ),
        _metric_block(
            "synckre_approvals",
            "Aprobaciones Human-in-the-Loop por estado",
            "gauge",
            series.get("approvals") or [],
            value_key="count",
            label_keys=("status",),
        ),
        _metric_block(
            "synckre_knowledge_sources",
            "Fuentes RAG indexadas por dominio y estado",
            "gauge",
            series.get("knowledge_sources") or [],
            value_key="count",
            label_keys=("domain", "status"),
        ),
        _metric_block(
            "synckre_document_chunks",
            "Chunks vectoriales por dominio",
            "gauge",
            series.get("document_chunks") or [],
            value_key="count",
            label_keys=("domain",),
        ),
    ]

    windows = (series.get("windows") or [{}])[0] if series.get("windows") else {}
    blocks.append(
        [
            "# HELP synckre_agent_runs_window Ejecuciones del agente en ventanas recientes",
            "# TYPE synckre_agent_runs_window gauge",
            f'synckre_agent_runs_window{{window="5m"}} {_num(windows.get("m5")):.6g}',
            f'synckre_agent_runs_window{{window="1h"}} {_num(windows.get("h1")):.6g}',
            f'synckre_agent_runs_window{{window="24h"}} {_num(windows.get("h24")):.6g}',
        ]
    )

    scalar_gauges = [
        ("synckre_pending_approvals", "Aprobaciones pendientes de un humano", stats.get("pending_approvals", 0)),
        ("synckre_active_conversations", "Conversaciones activas", stats.get("active_conversations", 0)),
        ("synckre_paused_human_conversations", "Conversaciones pausadas por escalación humana", stats.get("paused_human_conversations", 0)),
        ("synckre_erp_mutations_total", "Mutaciones ERP (leads/clientes)", stats.get("erp_mutations", 0)),
        ("synckre_calendar_bookings_total", "Altas y reagendos de calendario", stats.get("calendar_bookings", 0)),
        ("synckre_emails_sent_total", "Correos enviados por el agente", stats.get("emails_sent", 0)),
        ("synckre_rag_queries_total", "Consultas RAG / documentos", stats.get("rag_queries", 0)),
    ]
    for name, help_text, value in scalar_gauges:
        metric_type = "counter" if name.endswith("_total") else "gauge"
        blocks.append(
            [
                f"# HELP {name} {help_text}",
                f"# TYPE {name} {metric_type}",
                f"{name} {_num(value):.6g}",
            ]
        )

    lines: List[str] = []
    for block in blocks:
        if block:
            lines.extend(block)
    lines.append("")
    return "\n".join(lines)
