"""Google Calendar. Sin datos completos o sin credenciales, no agenda."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _datos_completos(nombre: str, email: str, motivo: str) -> str | None:
    if not (nombre or "").strip():
        return "Falta el nombre. Pídelo; no lo inventes."
    if not _EMAIL.match((email or "").strip()):
        return "Falta un email válido. Pídelo; no lo inventes."
    if not (motivo or "").strip():
        return "Falta el motivo de la cita. Pídelo; no lo inventes."
    return None


def _token() -> str | None:
    raw = (settings.GOOGLE_SERVICE_ACCOUNT_JSON or "").strip()
    path = (settings.GOOGLE_SERVICE_ACCOUNT_FILE or "").strip()
    info = None
    if raw:
        try:
            info = json.loads(raw)
        except json.JSONDecodeError:
            logger.error("GOOGLE_SERVICE_ACCOUNT_JSON no es JSON válido.")
            return None
    elif path and Path(path).is_file():
        info = json.loads(Path(path).read_text(encoding="utf-8"))
    if not info:
        return None
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request

        creds = service_account.Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/calendar.events"],
        )
        creds.refresh(Request())
        return creds.token
    except Exception as exc:
        logger.error("No se pudo autenticar en Google Calendar: %s", exc)
        return None


async def agendar_cita(nombre: str, email: str, motivo: str, inicio_iso: str = "") -> str:
    error = _datos_completos(nombre, email, motivo)
    if error:
        return error

    calendar_id = (settings.GOOGLE_CALENDAR_ID or "").strip()
    token = _token()
    if not token or not calendar_id:
        return (
            "No pude crear el evento: Calendar no está configurado "
            "(GOOGLE_CALENDAR_ID / cuenta de servicio). "
            "No confirmes la cita como agendada."
        )

    inicio = None
    if (inicio_iso or "").strip():
        try:
            inicio = datetime.fromisoformat(inicio_iso.replace("Z", "+00:00"))
        except ValueError:
            inicio = None
    if inicio is None:
        inicio = datetime.now(timezone.utc) + timedelta(days=1)
        inicio = inicio.replace(hour=15, minute=0, second=0, microsecond=0)
    fin = inicio + timedelta(minutes=45)

    payload = {
        "summary": f"Synckre · {motivo.strip()[:80]}",
        "description": f"Cliente: {nombre.strip()} <{email.strip()}>\nMotivo: {motivo.strip()}",
        "start": {"dateTime": inicio.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": fin.isoformat(), "timeZone": "UTC"},
        "attendees": [{"email": email.strip()}],
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
    except Exception as exc:
        logger.error("Calendar sin respuesta: %s", exc)
        return (
            f"Google Calendar no respondió. "
            "No confirmes la cita como agendada."
        )
    if resp.status_code >= 300:
        logger.error("Calendar %s: %s", resp.status_code, resp.text)
        return (
            f"Google Calendar rechazó el evento ({resp.status_code}). "
            "No confirmes la cita como agendada."
        )
    html = resp.json().get("htmlLink") or ""
    return f"Cita creada en Google Calendar para {nombre.strip()} ({email.strip()}). {html}".strip()
