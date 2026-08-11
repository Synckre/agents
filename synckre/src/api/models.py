"""Modelos Pydantic estrictos para request/response de la API.

Los campos de texto libre tienen longitud máxima (evita payloads gigantes)
y los modelos rechazan campos extra (extra="forbid").
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from api.settings import get_settings

_settings = get_settings()


class InvokeRequest(BaseModel):
    """Payload de POST /invoke y POST /stream."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    thread_id: str = Field(
        min_length=1,
        max_length=_settings.max_thread_id_length,
        pattern=r"^[A-Za-z0-9._-]+$",
        description="Identificador del hilo de conversación.",
    )
    mensaje: str = Field(
        min_length=1,
        max_length=_settings.max_mensaje_length,
        description="Mensaje del usuario.",
    )


class InvokeResponse(BaseModel):
    """Respuesta síncrona de POST /invoke."""

    model_config = ConfigDict(extra="forbid")

    thread_id: str
    respuesta: str


class MessageOut(BaseModel):
    """Mensaje individual del historial de un thread."""

    model_config = ConfigDict(extra="forbid")

    role: str
    content: str


class HistoryResponse(BaseModel):
    """Historial completo de un thread."""

    model_config = ConfigDict(extra="forbid")

    thread_id: str
    mensajes: list[MessageOut]


class ErrorResponse(BaseModel):
    """Respuesta de error neutra (nunca incluye stack traces)."""

    model_config = ConfigDict(extra="forbid")

    detalle: str
