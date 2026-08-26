"""
Plantillas de correo (HTML + texto) para Synckre Agent V2.
Estilos inline (seguros para clientes de correo).
"""

from __future__ import annotations

from datetime import datetime

from app.infrastructure.config import settings

COMPANY = settings.COMPANY_NAME or "Synckre"


def _base(contenido: str, lang: str = "es") -> str:
    footer = (
        f"This email was generated automatically by the {COMPANY} assistant. Please do not reply."
        if lang == "en"
        else f"Este correo fue generado automáticamente por el asistente de {COMPANY}. No respondas a este mensaje."
    )
    return f"""
<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #ffffff; color: #18181b; border-radius: 12px;">
  <div style="border-bottom: 2px solid #e4e4e7; padding-bottom: 16px; margin-bottom: 20px;">
    <span style="font-size: 20px; font-weight: 700; color: #18181b;">{COMPANY}</span>
  </div>
  {contenido}
  <div style="border-top: 1px solid #e4e4e7; margin-top: 24px; padding-top: 14px; color: #71717a; font-size: 12px;">
    {footer}
  </div>
</div>
"""


def _fecha_humana(iso: str, lang: str = "es") -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if lang == "en":
            return dt.strftime("%d %b %Y at %H:%M")
        return dt.strftime("%d/%m/%Y a las %H:%M")
    except Exception:
        return iso or "—"


def email_confirmacion_cita(
    nombre: str, fecha_iso: str, motivo: str, referencia: str, lang: str = "es"
) -> tuple[str, str, str, str, dict]:
    fecha = _fecha_humana(fecha_iso, lang)
    template_id = "email_confirmacion_cita_en" if lang == "en" else "email_confirmacion_cita"
    variables = {
        "nombre": nombre,
        "fecha": fecha,
        "fecha_iso": fecha_iso,
        "motivo": motivo or "—",
        "referencia": referencia,
    }
    if lang == "en":
        asunto = f"✅ Appointment confirmed — {COMPANY}"
        html = _base(
            f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hi {nombre}, your appointment is confirmed</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">We received your request and booked a meeting with our team.</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 8px 0; color: #71717a; width: 120px;">Date and time</td>
          <td style="padding: 8px 0; font-weight: 600;">{fecha}</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Topic</td>
          <td style="padding: 8px 0;">{motivo or '—'}</td></tr>
    </table>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">
      We'll send a reminder one day before and a few minutes before the meeting. If you need to reschedule, contact us.
    </p>
    """,
            lang="en",
        )
        texto = (
            f"Hi {nombre}, your appointment is confirmed.\n\n"
            f"Date and time: {fecha}\n"
            f"Topic: {motivo or '—'}\n\n"
            "We'll send a reminder before the meeting. If you need to reschedule, contact us."
        )
        return asunto, html, texto, template_id, variables
    asunto = f"✅ Cita confirmada — {COMPANY}"
    html = _base(f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hola {nombre}, tu cita quedó confirmada</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">Recibimos tu solicitud y agendamos la reunión con nuestro equipo.</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 8px 0; color: #71717a; width: 120px;">Fecha y hora</td>
          <td style="padding: 8px 0; font-weight: 600;">{fecha}</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Motivo</td>
          <td style="padding: 8px 0;">{motivo or '—'}</td></tr>
    </table>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">
      Te enviaremos un recordatorio un día antes y unos minutos antes de la cita. Si necesitas reagendar, contáctanos.
    </p>
    """)
    texto = (
        f"Hola {nombre}, tu cita quedó confirmada.\n\n"
        f"Fecha y hora: {fecha}\n"
        f"Motivo: {motivo or '—'}\n\n"
        "Te enviaremos un recordatorio antes de la cita. Si necesitas reagendar, contáctanos."
    )
    return asunto, html, texto, template_id, variables


def email_verificacion_registro(
    nombre: str, email: str, entidad: str = "", referencia: str = "", lang: str = "es"
) -> tuple[str, str, str, str, dict]:
    """Acuse de recibo al cliente. Sin datos internos. Idioma del lead/cliente."""
    template_id = "email_verificacion_registro_en" if lang == "en" else "email_verificacion_registro"
    variables = {
        "nombre": nombre,
        "email": email,
        "entidad": entidad,
        "referencia": referencia,
    }
    if lang == "en":
        asunto = f"📬 We received your information — {COMPANY}"
        html = _base(
            f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hi {nombre}, we have received your information</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">
      Thank you for writing. We received the details you sent
      and an advisor from {COMPANY} will get in touch with you shortly.
    </p>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">
      If you need anything in the meantime, just reply to this conversation. We're here to help.
    </p>
    """,
            lang="en",
        )
        texto = (
            f"Hi {nombre}, we have received your information.\n\n"
            f"Thank you for writing. We received the details you sent "
            f"and an advisor from {COMPANY} will get in touch with you shortly.\n\n"
            "We're here to help."
        )
        return asunto, html, texto, template_id, variables
    asunto = f"📬 Hemos recibido tu información — {COMPANY}"
    html = _base(f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hola {nombre}, hemos recibido tu información</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">
      Gracias por escribirnos. Hemos recibido correctamente los datos que nos enviaste
      y un asesor de {COMPANY} se pondrá en contacto contigo muy pronto.
    </p>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">
      Si mientras tanto necesitas algo, no dudes en escribirnos. ¡Estamos para ayudarte!
    </p>
    """)
    texto = (
        f"Hola {nombre}, hemos recibido tu información.\n\n"
        f"Gracias por escribirnos. Hemos recibido correctamente los datos que nos enviaste "
        f"y un asesor de {COMPANY} se pondrá en contacto contigo muy pronto.\n\n"
        "¡Estamos para ayudarte!"
    )
    return asunto, html, texto, template_id, variables


def email_recordatorio_cita(
    nombre: str,
    fecha_iso: str,
    motivo: str,
    referencia: str,
    tipo: str = "recordatorio",
    lang: str = "es",
) -> tuple[str, str, str, str, dict]:
    fecha = _fecha_humana(fecha_iso, lang)
    template_id = "email_recordatorio_cita_en" if lang == "en" else "email_recordatorio_cita"
    variables = {
        "nombre": nombre,
        "fecha": fecha,
        "fecha_iso": fecha_iso,
        "motivo": motivo or "—",
        "referencia": referencia,
        "tipo": tipo,
    }
    if lang == "en":
        asunto = f"⏰ Reminder: your appointment — {COMPANY}"
        lead = (
            "This is a reminder that you have a meeting with our team very soon."
            if tipo == "minutos"
            else "This is a reminder that you have a meeting with our team tomorrow."
        )
        html = _base(
            f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hi {nombre}, this is your reminder</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">{lead}</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 8px 0; color: #71717a; width: 120px;">Date and time</td>
          <td style="padding: 8px 0; font-weight: 600;">{fecha}</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Topic</td>
          <td style="padding: 8px 0;">{motivo or '—'}</td></tr>
    </table>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">We look forward to speaking with you.</p>
    """,
            lang="en",
        )
        texto = (
            f"Hi {nombre}, this is your reminder.\n\n"
            f"Date and time: {fecha}\n"
            f"Topic: {motivo or '—'}\n\nWe look forward to speaking with you."
        )
        return asunto, html, texto, template_id, variables
    asunto = f"⏰ Recordatorio de tu cita — {COMPANY}"
    lead = "Te recordamos que tienes una cita muy pronto con nuestro equipo." if tipo == "minutos" else "Te recordamos que mañana tienes una cita con nuestro equipo."
    html = _base(f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hola {nombre}, este es tu recordatorio</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">{lead}</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 8px 0; color: #71717a; width: 120px;">Fecha y hora</td>
          <td style="padding: 8px 0; font-weight: 600;">{fecha}</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Motivo</td>
          <td style="padding: 8px 0;">{motivo or '—'}</td></tr>
    </table>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">¡Te esperamos!</p>
    """)
    texto = (
        f"Hola {nombre}, este es tu recordatorio.\n\n"
        f"Fecha y hora: {fecha}\n"
        f"Motivo: {motivo or '—'}\n\n¡Te esperamos!"
    )
    return asunto, html, texto, template_id, variables


def email_continuar_conversacion(
    nombre: str, enlace: str, lang: str = "es"
) -> tuple[str, str, str, str, dict]:
    """Invitación a seguir con el cualificador comercial (no inmediato)."""
    template_id = "email_continuar_conversacion_en" if lang == "en" else "email_continuar_conversacion"
    variables = {
        "nombre": nombre,
        "enlace": enlace,
    }
    if lang == "en":
        asunto = f"Let's continue your conversation — {COMPANY}"
        html = _base(
            f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hi {nombre}, a specialist is ready to continue</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">
      Thanks again for reaching out. We'd like a bit more detail so we can help properly
      and, if it makes sense, book a meeting with the team.
    </p>
    <p style="margin: 0 0 16px;">
      <a href="{enlace}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">
        Continue the conversation
      </a>
    </p>
    <p style="margin: 0; color: #71717a; font-size: 13px;">If the button doesn't work: {enlace}</p>
    """,
            lang="en",
        )
        texto = (
            f"Hi {nombre}, a specialist is ready to continue.\n\n"
            f"Open this link to pick up where we left off:\n{enlace}\n"
        )
        return asunto, html, texto, template_id, variables
    asunto = f"Sigamos tu consulta — {COMPANY}"
    html = _base(f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hola {nombre}, un especialista puede continuar contigo</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">
      Gracias de nuevo por escribirnos. Queremos entender un poco mejor tu necesidad
      y, si encaja, agendar una reunión con el equipo.
    </p>
    <p style="margin: 0 0 16px;">
      <a href="{enlace}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">
        Continuar la conversación
      </a>
    </p>
    <p style="margin: 0; color: #71717a; font-size: 13px;">Si el botón no funciona: {enlace}</p>
    """)
    texto = (
        f"Hola {nombre}, un especialista puede continuar contigo.\n\n"
        f"Abre este enlace para retomar la conversación:\n{enlace}\n"
    )
    return asunto, html, texto, template_id, variables


def email_cita_interna(
    nombre: str, email: str, fecha_iso: str, motivo: str, meet_url: str = "", lang: str = "es"
) -> tuple[str, str, str, str, dict]:
    """Aviso al equipo Synckre."""
    fecha = _fecha_humana(fecha_iso, "es")
    template_id = "email_cita_interna_en" if lang == "en" else "email_cita_interna"
    variables = {
        "nombre": nombre,
        "email": email,
        "fecha": fecha,
        "fecha_iso": fecha_iso,
        "motivo": motivo or "—",
        "meet_url": meet_url,
    }
    asunto = f"📅 Nueva cita con {nombre} — {COMPANY}"
    meet = (
        f'<p style="margin:16px 0 0;font-size:14px;">Meet: <a href="{meet_url}">{meet_url}</a></p>'
        if meet_url
        else ""
    )
    html = _base(f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Cita comercial registrada</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 8px 0; color: #71717a; width: 120px;">Cliente</td>
          <td style="padding: 8px 0; font-weight: 600;">{nombre} ({email})</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Fecha y hora</td>
          <td style="padding: 8px 0; font-weight: 600;">{fecha}</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Motivo</td>
          <td style="padding: 8px 0;">{motivo or '—'}</td></tr>
    </table>
    {meet}
    """)
    texto = (
        f"Cita comercial registrada.\n\nCliente: {nombre} ({email})\n"
        f"Fecha y hora: {fecha}\nMotivo: {motivo or '—'}\n"
        + (f"Meet: {meet_url}\n" if meet_url else "")
    )
    return asunto, html, texto, template_id, variables
