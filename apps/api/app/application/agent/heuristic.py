"""Plan heurístico de desarrollo/offline. No se usa en producción."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.application.services.memory_service import extraer_datos
from app.infrastructure.db.manager import db_manager

_DIA_NOMBRE = {
    "lunes": 0, "martes": 1, "miércoles": 2, "miercoles": 2, "jueves": 3,
    "viernes": 4, "sábado": 5, "sabado": 5, "domingo": 6,
}
_DIA_NOMBRE_REV = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
_MESES_NOMBRE = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def detectar_slot(user_input: str) -> Optional[Dict[str, Any]]:
    """Detecta una selección de horario ('14:00 lunes 24') y devuelve {iso, humano}."""
    text = (user_input or "").lower()
    m_time = re.search(r"(\d{1,2}):(\d{2})", text)
    if not m_time:
        return None
    dia_semana = next((v for k, v in _DIA_NOMBRE.items() if k in text), None)
    if dia_semana is None:
        return None
    hora, minuto = int(m_time.group(1)), int(m_time.group(2))
    dia_mes = None
    for m in re.finditer(r"\b(\d{1,2})\b", text):
        val = int(m.group(1))
        if 1 <= val <= 31 and val != hora:
            dia_mes = val
            break
    from zoneinfo import ZoneInfo
    try:
        tz = ZoneInfo("UTC")
    except Exception:
        tz = timezone.utc
    ahora = datetime.now(timezone.utc).astimezone(tz)

    def _buscar(con_dia_mes: bool):
        for delta in range(1, 46):
            d = (ahora + timedelta(days=delta)).date()
            if d.weekday() != dia_semana:
                continue
            if con_dia_mes and dia_mes is not None and d.day != dia_mes:
                continue
            fecha = datetime(d.year, d.month, d.day, hora, minuto, tzinfo=tz)
            if fecha > ahora:
                return fecha
        return None

    fecha = _buscar(True) or _buscar(False)
    if fecha is None:
        return None
    return {
        "iso": fecha.astimezone(timezone.utc).isoformat(),
        "humano": (
            f"{_DIA_NOMBRE_REV[fecha.weekday()]} {fecha.day} de "
            f"{_MESES_NOMBRE[fecha.month - 1]}, {fecha.hour:02d}:{fecha.minute:02d}"
        ),
    }


async def datos_contacto(conversation_id: Optional[str], role_name: str, user_input: str):
    datos = extraer_datos(user_input)
    nombre, email, motivo = datos.get("name", ""), datos.get("email", ""), ""
    if conversation_id:
        conv = await db_manager.get_conversation(conversation_id)
        if conv and not email:
            email = str((conv.metadata or {}).get("customer_email") or "")
        if email:
            perfil = await db_manager.get_memory(email, role_name)
            if perfil:
                if not nombre:
                    nombre = perfil.get("name") or ""
                motivo = perfil.get("summary") or ""
    return nombre, email, motivo


async def heuristic_plan(
    user_input: str,
    tools: List[Dict[str, Any]],
    role_name: str = "",
    conversation_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Detección heurística de intención para dev/offline."""
    text = user_input.lower()
    tool_names = [t["name"] for t in tools]
    email_detectado = extraer_datos(user_input).get("email", "")

    if "create_event" in tool_names:
        slot = detectar_slot(user_input)
        if slot:
            nombre, email, motivo = await datos_contacto(conversation_id, role_name, user_input)
            if email:
                return {
                    "answer": f"Perfecto, agendo la cita para {slot['humano']}.",
                    "tool_to_call": "create_event",
                    "tool_args": {
                        "nombre": nombre or "Cliente",
                        "email": email,
                        "motivo": motivo or "Solicitud de reunión",
                        "inicio_iso": slot["iso"],
                    },
                }
            return {
                "answer": "Para agendar la cita necesito confirmar tu correo. ¿Cuál es tu correo?",
                "tool_to_call": None,
                "tool_args": {},
            }

    if "update_lead" in tool_names and email_detectado and (
        ("no es" in text and "correo" in text) or "corregir" in text
        or "actualizar mi correo" in text or "mi correo correcto" in text
    ):
        return {
            "answer": "Entendido, corrijo el email en el sistema.",
            "tool_to_call": "update_lead",
            "tool_args": {"email_nuevo": email_detectado},
        }

    if ("cancelar" in text or "anular" in text) and ("cita" in text or "reunión" in text):
        if "cancel_event" in tool_names:
            return {
                "answer": (
                    "Voy a cancelar tu cita. "
                    "Necesito la referencia (ref. EVT-...) o el email con el que la agendaste."
                ),
                "tool_to_call": "cancel_event",
                "tool_args": {"email": email_detectado},
            }

    if ("reagendar" in text or "reprogramar" in text or "cambiar la fecha" in text
            or ("mover" in text and "cita" in text)):
        if "reschedule_event" in tool_names:
            return {
                "answer": (
                    "Voy a reagendar tu cita. "
                    "Dime la referencia (ref. EVT-...) o el email, y la nueva fecha/hora."
                ),
                "tool_to_call": "reschedule_event",
                "tool_args": {"email": email_detectado, "nuevo_inicio_iso": ""},
            }

    if (
        ("cita" in text or "reunión" in text or "reunion" in text or "agendar" in text)
        and "create_event" not in tool_names
        and "transfer_to_agent" in tool_names
    ):
        return {
            "answer": "Con gusto te ayudo con la cita: te transfiero con el equipo que agenda las reuniones.",
            "tool_to_call": "transfer_to_agent",
            "tool_args": {"role": "customer_support"},
        }

    if "cita" in text or "reunión" in text or "reunion" in text or "agendar" in text:
        if "create_event" in tool_names:
            nombre = extraer_datos(user_input).get("name", "")
            email = email_detectado
            if nombre and email:
                return {
                    "answer": "Perfecto, agendo la cita con los datos que me diste.",
                    "tool_to_call": "create_event",
                    "tool_args": {"nombre": nombre, "email": email, "motivo": user_input},
                }
            return {
                "answer": "¡Claro! Para agendar la cita necesito tu nombre, tu correo y el motivo. ¿Me los confirmas?",
                "tool_to_call": None,
                "tool_args": {},
            }

    if "contrato" in text or "firmar" in text or "borrador" in text:
        if "generate_contract" in tool_names:
            return {
                "answer": "Procedo a generar un borrador de contrato según los términos solicitados.",
                "tool_to_call": "generate_contract",
                "tool_args": {
                    "cliente_nombre": "Cliente Empresa",
                    "cliente_email": "contacto@cliente.com",
                    "plantilla": "Mantenimiento",
                    "terminos": user_input,
                },
            }

    if "encargo" in text or "cotización" in text or "cotizacion" in text or "presupuesto" in text:
        if "create_lead" in tool_names:
            nombre = extraer_datos(user_input).get("name", "")
            email = email_detectado
            if nombre and email:
                return {
                    "answer": "Registro tu solicitud con los datos que me diste.",
                    "tool_to_call": "create_lead",
                    "tool_args": {"nombre": nombre, "email": email, "mensaje": user_input},
                }
            return {
                "answer": "Para registrar tu solicitud necesito tu nombre, tu correo y una breve descripción de lo que necesitas. ¿Me los confirmas?",
                "tool_to_call": None,
                "tool_args": {},
            }

    if "incidencia" in text or "error" in text or "fallo" in text or "servidor" in text:
        if "create_ticket" in tool_names:
            return {
                "answer": "Entiendo la situación. He registrado una incidencia técnica para seguimiento.",
                "tool_to_call": "create_ticket",
                "tool_args": {"sintoma": user_input, "sistema": "Infraestructura"},
            }

    if "transfer_to_agent" in tool_names and role_name:
        if role_name != "customer_support" and any(
            k in text for k in (
                "soporte", "incidencia", "avería", "averia", "no funciona",
                "fallo", "técnico", "tecnico", "problema con el sistema",
            )
        ):
            return {
                "answer": "Veo que necesitas soporte técnico. Te transfiero con nuestro equipo de soporte.",
                "tool_to_call": "transfer_to_agent",
                "tool_args": {"role": "customer_support"},
            }
        if role_name != "sales_assistant" and any(
            k in text for k in (
                "cotización", "cotizacion", "presupuesto", "ventas",
                "propuesta", "contratar", "servicios comerciales",
            )
        ):
            return {
                "answer": "Veo que tienes interés comercial. Te transfiero con el área comercial.",
                "tool_to_call": "transfer_to_agent",
                "tool_args": {"role": "sales_assistant"},
            }

    escalation_keywords = (
        "hablar con un humano",
        "hablar con una persona",
        "hablar con alguien",
        "con un humano",
        "con una persona",
        "operador humano",
        "agente humano",
        "agente real",
        "persona real",
        "atención humana",
        "asesor humano",
        "humano por favor",
    )
    if any(k in text for k in escalation_keywords):
        if "escalate_ticket" in tool_names:
            return {
                "answer": "Entendido, te comunico con un operador humano de inmediato. Estoy escalando tu solicitud.",
                "tool_to_call": "escalate_ticket",
                "tool_args": {"razon": user_input},
            }

    return {
        "answer": "Gracias por tu mensaje. Como asistente de Synckre, estoy a tu disposición para ayudarte.",
        "tool_to_call": None,
        "tool_args": {},
    }
