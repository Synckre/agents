"""Envío de correo. Misma interfaz; el proveedor se elige por EMAIL_PROVIDER.

Los mensajes de FALLO empiezan por "Envío fallido" (NUNCA contienen la subcadena
"enviado"), porque el scheduler de recordatorios detecta éxito con
`"enviado" in resultado.lower()`.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from app.infrastructure.config import settings

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    async def send(self, destinatario: str, asunto: str, cuerpo: str) -> str: ...


class ResendSender:
    async def send(self, destinatario: str, asunto: str, cuerpo: str, html: str | None = None) -> str:
        key = (settings.RESEND_API_KEY or "").strip()
        origen = (settings.EMAIL_FROM or "").strip()
        if not key or not origen:
            return (
                "Envío fallido: faltan RESEND_API_KEY o EMAIL_FROM. "
                "No confirmes el envío al cliente."
            )
        payload: dict = {"from": origen, "to": [destinatario], "subject": asunto, "text": cuerpo}
        if html:
            payload["html"] = html
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json=payload,
                )
        except Exception as exc:
            logger.error("Resend sin respuesta: %s", exc)
            return f"Envío fallido (Resend sin respuesta). No confirmes el envío."
        if resp.status_code >= 300:
            logger.error("Resend %s: %s", resp.status_code, resp.text)
            return f"Envío fallido (Resend {resp.status_code}). No confirmes el envío."
        return f"Correo enviado a {destinatario} vía Resend."


class SendGridSender:
    async def send(self, destinatario: str, asunto: str, cuerpo: str) -> str:
        key = (settings.SENDGRID_API_KEY or "").strip()
        origen = (settings.EMAIL_FROM or "").strip()
        if not key or not origen:
            return (
                "Envío fallido: faltan SENDGRID_API_KEY o EMAIL_FROM. "
                "No confirmes el envío al cliente."
            )
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "personalizations": [{"to": [{"email": destinatario}]}],
                        "from": {"email": origen},
                        "subject": asunto,
                        "content": [{"type": "text/plain", "value": cuerpo}],
                    },
                )
        except Exception as exc:
            logger.error("SendGrid sin respuesta: %s", exc)
            return f"Envío fallido (SendGrid sin respuesta). No confirmes el envío."
        if resp.status_code >= 300:
            logger.error("SendGrid %s: %s", resp.status_code, resp.text)
            return f"Envío fallido (SendGrid {resp.status_code}). No confirmes el envío."
        return f"Correo enviado a {destinatario} vía SendGrid."


def get_email_sender() -> EmailSender:
    provider = (settings.EMAIL_PROVIDER or "resend").strip().lower()
    if provider == "sendgrid":
        return SendGridSender()
    return ResendSender()


async def enviar_correo(destinatario: str, asunto: str, cuerpo: str) -> str:
    destinos = [d.strip() for d in (destinatario or "").split(",") if d.strip()]
    if not destinos or any("@" not in d for d in destinos):
        return "Envío fallido: destinatario inválido. Pide un email real."
    if not (asunto or "").strip() or not (cuerpo or "").strip():
        return "Envío fallido: faltan asunto o cuerpo. No inventes el contenido."
    sender = get_email_sender()
    resultados = [await sender.send(d, asunto.strip(), cuerpo.strip()) for d in destinos]
    return " | ".join(resultados)


async def enviar_correo_html(destinatario: str, asunto: str, cuerpo_html: str, cuerpo_texto: str) -> str:
    """Envía un correo con versión HTML y texto plano."""
    destinos = [d.strip() for d in (destinatario or "").split(",") if d.strip()]
    if not destinos or any("@" not in d for d in destinos):
        return "Envío fallido: destinatario inválido. Pide un email real."
    sender = get_email_sender()
    resultados = [
        await sender.send(d, asunto.strip(), cuerpo_texto.strip(), html=cuerpo_html)
        for d in destinos
    ]
    return " | ".join(resultados)
