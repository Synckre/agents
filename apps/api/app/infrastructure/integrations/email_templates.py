"""
Plantillas de correo (HTML + texto) para Synckre Agent V2.
Estilos inline (seguros para clientes de correo).
"""

from __future__ import annotations

from datetime import datetime

from app.infrastructure.config import settings

COMPANY = settings.COMPANY_NAME or "Synckre"


def _base(contenido: str) -> str:
    return f"""
<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #ffffff; color: #18181b; border-radius: 12px;">
  <div style="border-bottom: 2px solid #e4e4e7; padding-bottom: 16px; margin-bottom: 20px;">
    <span style="font-size: 20px; font-weight: 700; color: #18181b;">{COMPANY}</span>
    <span style="color: #71717a; font-size: 13px;"> · Agent Runtime</span>
  </div>
  {contenido}
  <div style="border-top: 1px solid #e4e4e7; margin-top: 24px; padding-top: 14px; color: #71717a; font-size: 12px;">
    Este correo fue generado automáticamente por el asistente de {COMPANY}. No respondas a este mensaje.
  </div>
</div>
"""


def _fecha_humana(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y a las %H:%M")
    except Exception:
        return iso or "—"


def email_confirmacion_cita(nombre: str, fecha_iso: str, motivo: str, referencia: str) -> tuple[str, str, str]:
    asunto = f"✅ Cita confirmada — {COMPANY}"
    html = _base(f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hola {nombre}, tu cita quedó confirmada</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">Recibimos tu solicitud y agendamos la reunión con nuestro equipo.</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 8px 0; color: #71717a; width: 120px;">Fecha y hora</td>
          <td style="padding: 8px 0; font-weight: 600;">{_fecha_humana(fecha_iso)}</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Motivo</td>
          <td style="padding: 8px 0;">{motivo or '—'}</td></tr>
    </table>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">
      Te enviaremos un recordatorio un día antes y unos minutos antes de la cita. Si necesitas reagendar, contáctanos.
    </p>
    """)
    texto = (
        f"Hola {nombre}, tu cita quedó confirmada.\n\n"
        f"Fecha y hora: {_fecha_humana(fecha_iso)}\n"
        f"Motivo: {motivo or '—'}\n\n"
        "Te enviaremos un recordatorio antes de la cita. Si necesitas reagendar, contáctanos."
    )
    return asunto, html, texto


def email_verificacion_registro(nombre: str, email: str, entidad: str = "", referencia: str = "") -> tuple[str, str, str]:
    """Correo de acuse de recibo del formulario de contacto.
    Sin datos internos (referencias, tipo de registro): solo confirma que recibimos la información."""
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
    return asunto, html, texto


def email_recordatorio_cita(nombre: str, fecha_iso: str, motivo: str, referencia: str, tipo: str = "recordatorio") -> tuple[str, str, str]:
    asunto = f"⏰ Recordatorio de tu cita — {COMPANY}"
    lead = "Te recordamos que tienes una cita muy pronto con nuestro equipo." if tipo == "minutos" else "Te recordamos que mañana tienes una cita con nuestro equipo."
    html = _base(f"""
    <h2 style="margin: 0 0 12px; font-size: 18px;">Hola {nombre}, este es tu recordatorio</h2>
    <p style="margin: 0 0 16px; color: #3f3f46; font-size: 14px;">{lead}</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
      <tr><td style="padding: 8px 0; color: #71717a; width: 120px;">Fecha y hora</td>
          <td style="padding: 8px 0; font-weight: 600;">{_fecha_humana(fecha_iso)}</td></tr>
      <tr><td style="padding: 8px 0; color: #71717a;">Motivo</td>
          <td style="padding: 8px 0;">{motivo or '—'}</td></tr>
    </table>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">¡Te esperamos!</p>
    """)
    texto = (
        f"Hola {nombre}, este es tu recordatorio.\n\n"
        f"Fecha y hora: {_fecha_humana(fecha_iso)}\n"
        f"Motivo: {motivo or '—'}\n\n¡Te esperamos!"
    )
    return asunto, html, texto
