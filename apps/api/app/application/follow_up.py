"""Seguimiento diferido tras el formulario de contacto."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urljoin

from app.application.jobs import JobKind
from app.application.public_limits import (
    FOLLOW_UP_DELAY_MINUTES,
    FOLLOW_UP_ROLE,
    PUBLIC_CONTINUE_PATH,
)
from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.email import enviar_correo_html
from app.infrastructure.integrations.email_templates import email_continuar_conversacion


def continue_url(token: str) -> str:
    base = (settings.PUBLIC_SITE_URL or "https://www.synckre.com").rstrip("/") + "/"
    return urljoin(base, f"{PUBLIC_CONTINUE_PATH.lstrip('/')}?token={token}")


async def schedule_lead_follow_up(
    *,
    conversation_id: Optional[str],
    nombre: str,
    email: str,
    lang: str = "es",
) -> Optional[str]:
    """Encola el mail de continuación (no inmediato). Idempotente por conversación."""
    if not conversation_id or "@" not in (email or ""):
        return None
    token = secrets.token_urlsafe(24)
    await db_manager.update_conversation_metadata(
        conversation_id,
        {
            "resume_token": token,
            "follow_up_role": FOLLOW_UP_ROLE,
            "customer_email": email,
        },
    )
    from app.application.services.job_scheduler import job_scheduler

    run_at = datetime.now(timezone.utc) + timedelta(minutes=FOLLOW_UP_DELAY_MINUTES)
    job = await job_scheduler.enqueue(
        kind=JobKind.follow_up.value,
        payload={
            "conversation_id": conversation_id,
            "nombre": nombre,
            "email": email,
            "lang": lang,
            "token": token,
        },
        run_at=run_at,
        idempotency_key=f"follow_up:{conversation_id}",
    )
    return job.id if job else token


async def send_follow_up_email(payload: dict) -> None:
    token = payload.get("token") or ""
    email = payload.get("email") or ""
    nombre = payload.get("nombre") or "there"
    lang = payload.get("lang") or "es"
    conversation_id = payload.get("conversation_id")
    if not token or "@" not in email:
        return
    enlace = continue_url(token)
    asunto, html, texto = email_continuar_conversacion(nombre, enlace, lang=lang)
    await enviar_correo_html(email, asunto, html, texto)
    if conversation_id:
        await db_manager.update_conversation_role(conversation_id, FOLLOW_UP_ROLE)
        await db_manager.update_conversation_metadata(
            conversation_id, {"follow_up_sent_at": datetime.now(timezone.utc).isoformat()}
        )
