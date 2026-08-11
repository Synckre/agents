"""Logging estructurado (structlog, JSON) con redacción de secretos.

Nunca se loguean: API keys, tokens, DATABASE_URL completa ni el contenido
completo de mensajes de usuario (solo longitud/hash vía hash_text()).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sys
from typing import Any, MutableMapping

import structlog

from api.settings import Settings

_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"sk-[A-Za-z0-9_-]{8,}"),  # claves estilo OpenAI/DeepSeek
    re.compile(r"(postgres(?:ql)?://)([^@\s]+)@"),  # credenciales en DATABASE_URL
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE),  # tokens
    re.compile(r"lsv2_[A-Za-z0-9]+"),  # claves LangSmith
)


def redact(value: str) -> str:
    """Sustituye secretos conocidos por marcadores seguros."""
    value = _SECRET_PATTERNS[0].sub("sk-***", value)
    value = _SECRET_PATTERNS[1].sub(r"\1***@", value)
    value = _SECRET_PATTERNS[2].sub("Bearer ***", value)
    value = _SECRET_PATTERNS[3].sub("lsv2_***", value)
    return value


def redact_processor(
    _: Any, __: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Processor de structlog que redacta cualquier string con secretos."""
    for key, val in list(event_dict.items()):
        if isinstance(val, str):
            event_dict[key] = redact(val)
    return event_dict


def hash_text(value: str) -> str:
    """Hash corto (16 hex) para loguear contenido sin exponerlo."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


class _JsonFormatter(logging.Formatter):
    """Formatter JSON para los loggers estándar (uvicorn, httpx, etc.)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(settings: Settings) -> None:
    """Configura structlog (JSON) y los loggers estándar (JSON), al nivel indicado."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.handlers = [handler]

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            redact_processor,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(ensure_ascii=False),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(sys.stdout),
        cache_logger_on_first_use=True,
    )
