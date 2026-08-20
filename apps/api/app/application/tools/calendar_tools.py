"""
Herramientas de Calendario para Synckre Agent V2.

Agenda en ERPNext (control de la agenda de la compañía), envía el correo de
confirmación al cliente y programa recordatorios automáticos
(1 día antes y N minutos antes de la cita).

La disponibilidad se resuelve así:
1) Note "Synckre Availability" en ERPNext (JSON: days, hours, timezone, duration) — editable desde el UI de ERPNext.
2) Fallback fijo (Lun-Vie 10:00/15:00 UTC, 30 min) si ERPNext no está configurado o no responde.
"""

from datetime import datetime, timedelta, timezone
import logging
import time
import uuid
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from app.application.agent.tools_registry import tool_registry
from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.email import enviar_correo_html
from app.infrastructure.integrations.email_templates import email_confirmacion_cita
from app.infrastructure.integrations.erp import erpnext_client
from app.infrastructure.integrations.calendar import agendar_cita  # fallback Google Calendar

logger = logging.getLogger("calendar_tools")

_DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

# Caché corta de la configuración de disponibilidad (ERPNext) para no llamar
# a ERPNext en cada consulta de horarios.
_CONFIG_CACHE: Dict[str, Any] = {}
_CONFIG_CACHE_TS = 0.0
_CONFIG_CACHE_TTL = 60.0  # segundos


def clear_availability_cache() -> None:
    """Invalida la caché de disponibilidad (p.ej. tras cambiar la config en ERPNext)."""
    global _CONFIG_CACHE, _CONFIG_CACHE_TS
    _CONFIG_CACHE = {}
    _CONFIG_CACHE_TS = 0.0

# day_of_week -> índice (0=Lunes) ; acepta inglés y español
_DIA_INDICE = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4,
    "saturday": 5, "sunday": 6,
    "lunes": 0, "martes": 1, "miércoles": 2, "miercoles": 2, "jueves": 3,
    "viernes": 4, "sábado": 5, "sabado": 5, "domingo": 6,
}


def _hora_a_minutos(valor: str) -> int:
    """Convierte '09:00' o '09:00:00' a minutos del día (540)."""
    try:
        hh, mm = (valor or "").split(":")[:2]
        return int(hh) * 60 + int(mm)
    except Exception:
        return 0


def _minutos_a_hora(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def _zona(nombre_tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(nombre_tz)
    except Exception:
        return timezone.utc


def _slot_humano(dt: datetime) -> str:
    return f"{_DIAS[dt.weekday()]} {dt.day} de {_MESES[dt.month - 1]} de {dt.year}, {dt.hour:02d}:{dt.minute:02d}"


async def _config_disponibilidad() -> Dict[str, Any]:
    """Resuelve la disponibilidad de la agenda (con caché corta para no golpear ERPNext).

    ERPNext es la ÚNICA fuente de verdad: 'Appointment Booking Settings'
    (enable_scheduling + availability_of_slots: day_of_week / from_time / to_time;
    appointment_duration en minutos). Genera huecos cada `duration` dentro de cada ventana.

    Si ERPNext no está configurado o no devuelve una disponibilidad válida, devuelve {}:
    NO se inventan horarios (check_availability/create_event lo comunican con claridad).
    Devuelve: {days, hours_by_day, timezone, duration, source} o {}.
    """
    global _CONFIG_CACHE, _CONFIG_CACHE_TS
    if _CONFIG_CACHE and (time.monotonic() - _CONFIG_CACHE_TS) < _CONFIG_CACHE_TTL:
        return _CONFIG_CACHE

    resultado: Dict[str, Any] = {}
    cfg = await erpnext_client.get_appointment_booking_settings()
    if cfg and cfg.get("enable_scheduling"):
        slots = cfg.get("availability_of_slots") or []
        duration = int(cfg.get("appointment_duration") or 30) or 30
        hours_by_day: Dict[int, list[int]] = {}
        for row in slots:
            dia = _DIA_INDICE.get((row.get("day_of_week") or "").strip().lower())
            if dia is None:
                continue
            inicio = _hora_a_minutos(row.get("from_time"))
            fin = _hora_a_minutos(row.get("to_time"))
            if fin <= inicio:
                continue
            minutos = list(range(inicio, fin, duration))
            hours_by_day.setdefault(dia, []).extend(minutos)
        if hours_by_day:
            resultado = {
                "days": sorted(hours_by_day.keys()),
                "hours_by_day": {d: sorted(set(h)) for d, h in hours_by_day.items()},
                "timezone": "UTC",  # ERPNext guarda horas en tz del servidor
                "duration": duration,
                "source": "erpnext",
            }
    _CONFIG_CACHE, _CONFIG_CACHE_TS = resultado, time.monotonic()
    return resultado


def _parse_inicio(inicio_iso: str) -> Optional[datetime]:
    if not (inicio_iso or "").strip():
        return None
    try:
        dt = datetime.fromisoformat(inicio_iso.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _next_available(cfg: Dict[str, Any]) -> Optional[datetime]:
    """Próximo hueco útil según la disponibilidad de ERPNext (evita horas pasadas).

    Devuelve None si no hay disponibilidad configurada (el llamador debe comunicarlo).
    """
    if not cfg:
        return None
    now = datetime.now(timezone.utc)
    tz = _zona(cfg["timezone"])
    local_now = now.astimezone(tz)
    for day in range(0, 8):
        d = (local_now + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
        if d.weekday() not in cfg["days"]:
            continue
        for minutos in sorted(cfg["hours_by_day"].get(d.weekday(), [])):
            slot_local = d + timedelta(minutes=minutos)
            slot_utc = slot_local.astimezone(timezone.utc)
            if slot_utc > now:
                return slot_utc
    return None


async def _programar_recordatorios(
    *,
    event_id: str,
    conversation_id: Optional[str],
    client_name: str,
    client_email: str,
    inicio: datetime,
    motivo: str = "",
) -> None:
    """Crea los recordatorios automáticos (1 día antes y minutos antes)."""
    minutes_before = settings.APPOINTMENT_REMINDER_MINUTES
    await db_manager.create_appointment_reminder(
        event_id=event_id,
        conversation_id=conversation_id,
        client_name=client_name,
        client_email=client_email,
        appointment_at=inicio,
        reminder_type="day_before",
        scheduled_for=inicio - timedelta(days=1),
        motivo=motivo,
    )
    await db_manager.create_appointment_reminder(
        event_id=event_id,
        conversation_id=conversation_id,
        client_name=client_name,
        client_email=client_email,
        appointment_at=inicio,
        reminder_type="minutes_before",
        scheduled_for=inicio - timedelta(minutes=minutes_before),
        motivo=motivo,
    )


async def _registrar_lead_erpnext(nombre: str, email: str) -> str:
    """Registra (o recupera si ya existe) el Lead del cliente en ERPNext, sin duplicados."""
    try:
        lead_id = await erpnext_client._find_lead_by_email(email)
        if lead_id:
            return lead_id
        res = await erpnext_client.create_lead(lead_name=nombre, email_id=email)
        return res.get("lead_id") or ""
    except Exception as exc:
        logger.error(f"Error registrando lead en ERPNext: {exc}")
        return ""


async def _confirmar_cita(cliente_nombre: str, cliente_email: str, inicio: datetime, motivo: str, referencia: str) -> str:
    """Envía el correo de confirmación de la cita."""
    asunto, html, texto = email_confirmacion_cita(
        nombre=cliente_nombre,
        fecha_iso=inicio.isoformat(),
        motivo=motivo,
        referencia=referencia,
    )
    try:
        return await enviar_correo_html(cliente_email, asunto, html, texto)
    except Exception as exc:
        return f"Envío fallido: {exc}"


@tool_registry.register(
    name="check_availability",
    description="Consulta horarios disponibles en la agenda según la disponibilidad de la empresa (configurada en ERPNext, Note 'Synckre Availability'). SOLO devuelve horarios futuros, limitados a un máximo para no abrumar al usuario.",
    required_capabilities=["calendar.read"],
    risk_level=1,
)
async def check_availability(dias_ahead: int = 7, max_slots: int = 10) -> Dict[str, Any]:
    cfg = await _config_disponibilidad()
    if not cfg:
        return {
            "status": "success",
            "available_slots": [],
            "slots_human": [],
            "source": "none",
            "message": (
                "No hay disponibilidad configurada en ERPNext (Appointment Booking Settings). "
                "No puedo ofrecer horarios: contacta a un operador para agendar."
            ),
        }
    now = datetime.now(timezone.utc)
    tz = _zona(cfg["timezone"])
    local_now = now.astimezone(tz)
    slots: list[datetime] = []
    for day in range(1, dias_ahead + 1):
        d = (local_now + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
        if d.weekday() not in cfg["days"]:
            continue  # día no laborable
        for minutos in sorted(cfg["hours_by_day"].get(d.weekday(), [])):
            slot_local = d + timedelta(minutes=minutos)
            slot_utc = slot_local.astimezone(timezone.utc)
            if slot_utc <= now:
                continue  # descartar horarios que ya pasaron
            slots.append(slot_utc)
            if len(slots) >= max_slots:
                break
        if len(slots) >= max_slots:
            break
    slots = sorted(slots)
    return {
        "status": "success",
        "available_slots": [s.isoformat() for s in slots],
        "slots_human": [_slot_humano(s.astimezone(tz)) for s in slots],
        "source": cfg.get("source", "env"),
        "message": (
            f"Se encontraron {len(slots)} horarios disponibles en los próximos {dias_ahead} días "
            f"(solo horarios futuros, {cfg['timezone']})."
        ),
    }


@tool_registry.register(
    name="create_event",
    description="Agenda una cita en la agenda de la compañía (ERPNext) exigiendo nombre, email y motivo. Envía confirmación y recordatorios automáticos al cliente.",
    required_capabilities=["calendar.write"],
    risk_level=2,
    idempotency_strategy="task_id",
)
async def create_event(
    nombre: str,
    email: str,
    motivo: str,
    inicio_iso: str = "",
    conversation_id: Optional[str] = None,
) -> Dict[str, Any]:
    # 1) Validar datos
    if not (nombre or "").strip():
        return {"status": "permanent_failure", "message": "Falta el nombre. Pídelo; no lo inventes."}
    if "@" not in (email or "") or "." not in (email or ""):
        return {"status": "permanent_failure", "message": "Falta un email válido. Pídelo; no lo inventes."}
    if not (motivo or "").strip():
        return {"status": "permanent_failure", "message": "Falta el motivo de la cita. Pídelo; no lo inventes."}

    cfg = await _config_disponibilidad()
    inicio = _parse_inicio(inicio_iso) or _next_available(cfg)
    if inicio is None:
        return {
            "status": "permanent_failure",
            "message": (
                "No hay disponibilidad configurada en ERPNext (Appointment Booking Settings) y no "
                "elegiste un horario. No puedo agendar sin horarios reales: contacta a un operador."
            ),
        }
    # Validación: no agendar en un horario que ya pasó
    if inicio <= datetime.now(timezone.utc):
        return {
            "status": "permanent_failure",
            "message": "El horario elegido ya pasó. Ofrece al cliente uno de los horarios disponibles (futuros).",
        }
    duracion = int(cfg.get("duration") or 30) or 30
    fin = inicio + timedelta(minutes=duracion)

    # 2) Crear el evento en ERPNext (control de agenda de la compañía)
    evento = await erpnext_client.create_event(
        subject=f"Cita {nombre} — {motivo[:60]}",
        starts_on=inicio.isoformat(),
        ends_on=fin.isoformat(),
        description=motivo,
        client_name=nombre,
        client_email=email,
    )

    if not evento["ok"]:
        # Fallback a Google Calendar si estaba configurado previamente
        res = await agendar_cita(nombre, email, motivo, inicio.isoformat())
        if "No pude crear el evento" in res or "rechazó" in res or "Falta" in res:
            return {"status": "temporary_failure", "message": f"{evento['error']} {res}".strip()}
        event_id = f"GCAL-{uuid.uuid4().hex[:10]}"
        referencia = event_id
        agenda_origen = "google_calendar"
    else:
        event_id = evento["event_id"] or f"EVT-{uuid.uuid4().hex[:10]}"
        referencia = event_id
        agenda_origen = "erpnext"

    # 3) Programar recordatorios automáticos (1 día antes + minutos antes)
    await _programar_recordatorios(
        event_id=referencia,
        conversation_id=conversation_id,
        client_name=nombre,
        client_email=email,
        inicio=inicio,
        motivo=motivo,
    )

    # 3b) Registrar/recuperar el Lead del cliente en ERPNext (sin duplicados)
    lead_id = await _registrar_lead_erpnext(nombre, email)

    # 4) Correo de confirmación al cliente
    email_result = await _confirmar_cita(nombre, email, inicio, motivo, referencia)
    email_ok = "enviado" in (email_result or "").lower()

    base_msg = (
        f"Cita agendada el {inicio.strftime('%d/%m/%Y a las %H:%M')} (ref. {referencia}). "
        f"Agenda: {agenda_origen}."
    )
    if email_ok:
        mensaje = (
            f"{base_msg} Correo de confirmación enviado a {email}. "
            f"Si no te llega en unos minutos, avísame y lo revisamos."
        )
    else:
        mensaje = (
            f"{base_msg} ⚠️ El correo de confirmación NO pudo enviarse a {email}. "
            f"Detalle: {email_result}. Por favor confirma que la dirección es correcta."
        )
    return {
        "status": "success",
        "event_id": referencia,
        "agenda": agenda_origen,
        "starts_on": inicio.isoformat(),
        "lead_id": lead_id,
        "email_sent": email_ok,
        "email_result": email_result,
        "message": mensaje,
    }


@tool_registry.register(
    name="reschedule_event",
    description="Reagenda una cita previamente creada.",
    required_capabilities=["calendar.write"],
    risk_level=2,
)
async def reschedule_event(event_id: str = "", nuevo_inicio_iso: str = "", email: str = "") -> Dict[str, Any]:
    """Reagenda una cita en ERPNext y reprograma sus recordatorios.

    Acepta la referencia del evento (event_id) o el email del cliente: si no se
    pasa event_id, se busca la próxima cita futura de ese email.
    """
    event_id = (event_id or "").strip()
    email = (email or "").strip()
    if not event_id and email and "@" in email:
        ev = await db_manager.get_next_event_by_email(email)
        if ev and ev.get("event_id"):
            event_id = ev["event_id"]
    if not event_id or not nuevo_inicio_iso:
        return {
            "status": "permanent_failure",
            "message": "Faltan la referencia de la cita (ref. EVT-...) o la nueva fecha. "
                      "Si no la tiene, pídele el email con el que agendó para localizarla.",
        }
    inicio = _parse_inicio(nuevo_inicio_iso)
    if not inicio:
        return {"status": "permanent_failure", "message": f"Formato de fecha inválido: '{nuevo_inicio_iso}'."}
    if inicio <= datetime.now(timezone.utc):
        return {"status": "permanent_failure", "message": "El nuevo horario ya pasó. Ofrece uno futuro."}

    cfg = await _config_disponibilidad()
    duracion = int(cfg.get("duration") or 30) or 30
    fin = inicio + timedelta(minutes=duracion)

    res = await erpnext_client.reschedule_event(event_id, inicio.isoformat(), fin.isoformat())
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo reagendar en ERPNext: {res.get('error')}"}

    # Reprogramar recordatorios: usar los datos del cliente guardados en la cita original
    datos = await db_manager.get_reminders_for_event(event_id)
    await db_manager.delete_reminders(event_id)
    if datos:
        await _programar_recordatorios(
            event_id=event_id,
            conversation_id=None,
            client_name=datos.get("client_name") or "",
            client_email=datos.get("client_email") or "",
            inicio=inicio,
            motivo=datos.get("motivo") or "",
        )
    return {
        "status": "success",
        "message": f"Evento {event_id} reagendado para {inicio.isoformat()}. Recordatorios reprogramados.",
        "starts_on": inicio.isoformat(),
    }


@tool_registry.register(
    name="cancel_event",
    description="Cancela una cita existente (acepta la referencia del evento o el email del cliente).",
    required_capabilities=["calendar.write"],
    risk_level=2,
)
async def cancel_event(event_id: str = "", motivo: str = "", email: str = "") -> Dict[str, Any]:
    event_id = (event_id or "").strip()
    email = (email or "").strip()
    if not event_id and email and "@" in email:
        ev = await db_manager.get_next_event_by_email(email)
        if ev and ev.get("event_id"):
            event_id = ev["event_id"]
    if not event_id:
        return {
            "status": "permanent_failure",
            "message": "Falta la referencia de la cita a cancelar (ref. EVT-...) o el email con el que se agendó.",
        }
    res = await erpnext_client.cancel_event(event_id)
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo cancelar: {res.get('error')}"}
    # Desactivar recordatorios pendientes de la cita cancelada
    await db_manager.delete_reminders(event_id)
    return {
        "status": "success",
        "message": f"Evento {event_id} cancelado correctamente. Recordatorios desactivados.",
    }
