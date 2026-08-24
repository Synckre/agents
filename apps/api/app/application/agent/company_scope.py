"""El chat público solo habla de Synckre. ERP interno se resume en español."""

from __future__ import annotations

import re
from typing import Optional

from app.application.agent.language import Lang

_OFF_TOPIC = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(chiste|chistes|joke|jokes|meme|memes)\b",
        r"\b(receta|recetas|recipe|recipes|cocinar|cookbook)\b",
        r"\b(poema|poesía|poem|poems|haiku|lyrics|canción|cancion)\b",
        r"\b(horóscopo|horoscopo|horoscope|zodiac|tarot)\b",
        r"\b(minecraft|fortnite|pokemon|pokémon|roblox)\b",
        r"\b(escribe(me)?|write)\s+(un |una |a |an )?(historia|cuento|ensayo|story|essay|novela)\b",
        r"\b(capital of|capital de)\b",
        r"\bwho won\b",
        r"\bquién ganó\b",
        r"\b(2\s*\+\s*2|cuánto es \d)\b",
        r"\b(cuéntame un secreto|tell me a secret)\b",
        r"\b(novia|novio|ligar|tinder)\b",
    )
]


def is_off_topic(texto: str) -> bool:
    t = (texto or "").strip()
    if len(t) < 4:
        return False
    return any(p.search(t) for p in _OFF_TOPIC)


def off_topic_reply(lang: Lang) -> str:
    if lang == "en":
        return (
            "I'm Synckre's assistant — I can help with our engineering and technology "
            "services (cloud & infrastructure, data & systems, software & automation, AI, "
            "and support), booking a meeting, or registering your request. "
            "What do you need from Synckre?"
        )
    return (
        "Soy el asistente de Synckre: te ayudo con nuestros servicios de ingeniería y "
        "tecnología (infraestructura y cloud, datos y sistemas, software y automatización, "
        "IA y soporte), a agendar una reunión o a registrar tu solicitud. "
        "¿En qué de Synckre te puedo ayudar?"
    )


def company_scope_prompt() -> str:
    return (
        "COMPANY SCOPE / ÁMBITO (obligatorio):\n"
        "- You only help with Synckre: cloud & infrastructure, data & systems, software & "
        "automation, AI, operations/support, meetings, leads, tickets and company info.\n"
        "- Solo ayudas con Synckre: infraestructura y cloud, datos y sistemas, software y "
        "automatización, IA, operación/soporte, citas, leads, tickets e información de la empresa.\n"
        "- If the user asks for entertainment, homework, generic chat, other companies, or "
        "anything unrelated: politely refuse and steer back to Synckre. Do not call tools.\n"
        "- Si pide ocio, deberes, charla genérica u otra empresa: rechaza con cortesía y "
        "devuelve a Synckre. No invoques tools.\n"
        "- CRM notes in ERPNext must be written in Spanish (internal). Emails to the client "
        "must be in the client's language.\n"
        "- Las notas CRM en ERPNext van en español (interno). Los correos al cliente, en su idioma.\n\n"
    )


def resumen_interno_erp(
    *,
    nombre: str = "",
    email: str = "",
    empresa: str = "",
    telefono: str = "",
    consulta: str = "",
    origen: str = "",
    idioma_cliente: str = "",
) -> str:
    """Resumen para ERPNext siempre en español. El texto del cliente se cita literal."""
    lineas = ["Resumen interno CRM (español):"]
    if idioma_cliente:
        lineas.append(
            f"- Idioma de contacto con el cliente: {'inglés' if idioma_cliente == 'en' else 'español'}."
        )
    if nombre:
        lineas.append(f"- Nombre: {nombre}")
    if email:
        lineas.append(f"- Email: {email}")
    if empresa:
        lineas.append(f"- Empresa: {empresa}")
    if telefono:
        lineas.append(f"- Teléfono: {telefono}")
    if origen:
        lineas.append(f"- Origen: {origen}")
    if consulta and consulta.strip():
        lineas.append("- Consulta del cliente (texto original, no traducir):")
        lineas.append(consulta.strip()[:1500])
    return "\n".join(lineas)


def nota_interna_erp(nota: str) -> str:
    cuerpo = (nota or "").strip()
    if not cuerpo:
        return ""
    if cuerpo.startswith("Resumen interno CRM") or cuerpo.startswith("Nota interna CRM"):
        return cuerpo[:2000]
    return (
        "Nota interna CRM (español).\n"
        "Detalle (texto original conservado):\n"
        f"{cuerpo[:1800]}"
    )


async def idioma_contacto(conversation_id: Optional[str] = None, texto: str = "") -> Lang:
    from app.application.agent.language import detect_text_language
    from app.infrastructure.db.manager import db_manager

    if conversation_id:
        try:
            conv = await db_manager.get_conversation(conversation_id)
            stored = (conv.metadata or {}).get("user_language") if conv else None
            if stored in ("en", "es"):
                return stored
        except Exception:
            pass
    if texto:
        lang, conf = detect_text_language(texto)
        if lang and conf >= 40:
            return lang
    return "es"
