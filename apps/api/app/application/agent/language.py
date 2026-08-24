"""Detección del idioma del usuario. El modelo no decide: el texto del usuario sí."""

from __future__ import annotations

import re
from typing import Iterable, List, Optional, Tuple

Lang = str  # "es" | "en"

_EMAILS = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}")
_URLS = re.compile(r"https?://\S+")
_WORDS = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+")

# Palabras función / léxico que casi no se solapan.
_EN = frozenset(
    {
        "the", "and", "you", "your", "yours", "please", "hello", "hi", "hey",
        "we", "our", "need", "want", "can", "could", "would", "should",
        "thanks", "thank", "meeting", "schedule", "appointment", "help",
        "this", "that", "with", "from", "have", "has", "been", "will",
        "not", "yes", "yeah", "yep", "okay", "hi", "what", "when", "where",
        "how", "about", "just", "like", "also", "let", "know", "call",
        "email", "name", "book", "available", "tomorrow", "today", "morning",
        "afternoon", "looking", "interested", "service", "services", "team",
        "i'd", "i'm", "i've", "don't", "can't", "it's",
    }
)
_ES = frozenset(
    {
        "hola", "buenas", "buen", "días", "dias", "tardes", "necesito", "quiero",
        "puedes", "puede", "podrias", "podrías", "gracias", "por", "para",
        "una", "unos", "unas", "cita", "reunión", "reunion", "agendar",
        "correo", "nombre", "ayuda", "favor", "tengo", "hacer", "está",
        "esta", "están", "como", "cómo", "qué", "que", "cuál", "cual",
        "cuando", "cuándo", "donde", "dónde", "también", "tambien",
        "disponible", "mañana", "manana", "hoy", "tarde", "equipo",
        "servicio", "servicios", "interesado", "interesada", "llamame",
        "llámame", "confirmo", "correcto", "vale", "perfecto", "claro",
    }
)
_EN_SHORT = frozenset({"yes", "yeah", "yep", "please", "thanks", "hi", "hello", "ok", "okay"})
_ES_SHORT = frozenset({"sí", "si", "vale", "gracias", "hola", "dale", "ok", "okay", "va"})

_ACCENTS = set("áéíóúüñÁÉÍÓÚÜÑ")


def _strip_noise(texto: str) -> str:
    texto = _EMAILS.sub(" ", texto or "")
    texto = _URLS.sub(" ", texto)
    return texto


def _tokens(texto: str) -> List[str]:
    return [t.casefold() for t in _WORDS.findall(_strip_noise(texto))]


def _score(tokens: Iterable[str]) -> Tuple[int, int, int]:
    en = es = 0
    accent = 0
    for t in tokens:
        if t in _EN:
            en += 2 if t not in {"ok", "okay"} else 0
        if t in _ES:
            es += 2 if t not in {"ok", "okay"} else 0
        if any(ch in _ACCENTS for ch in t):
            accent += 3
            es += 1
    return en, es + accent, accent


def detect_text_language(texto: str) -> Tuple[Optional[Lang], int]:
    """Devuelve (idioma o None si débil, confianza 0-100)."""
    raw = (texto or "").strip()
    if not raw:
        return None, 0
    tokens = _tokens(raw)
    if not tokens:
        return None, 0

    # Confirmaciones cortas
    joined = " ".join(tokens)
    if len(tokens) <= 3:
        only_en = any(t in _EN_SHORT - {"ok", "okay"} for t in tokens)
        only_es = any(t in _ES_SHORT - {"ok", "okay", "si"} for t in tokens) or "sí" in raw.casefold()
        if only_en and not only_es:
            return "en", 70
        if only_es and not only_en:
            return "es", 70
        return None, 20

    en, es, _ = _score(tokens)
    total = en + es
    if total == 0:
        return None, 10
    if en >= es + 2:
        return "en", min(100, 50 + en * 5)
    if es >= en + 2:
        return "es", min(100, 50 + es * 5)
    if en > es:
        return "en", 40
    if es > en:
        return "es", 40
    return None, 25


def detect_user_language(
    current: str,
    *,
    history: Optional[List[str]] = None,
    stored: Optional[str] = None,
) -> Tuple[Lang, bool]:
    """Idioma del turno: mensaje actual, si es débil historial, si no metadato.

    Devuelve (lang, confident) — confident True si conviene persistir.
    """
    stored_norm = stored if stored in {"en", "es"} else None
    lang, conf = detect_text_language(current)
    if lang and conf >= 50:
        return lang, True

    hist = [h for h in (history or []) if (h or "").strip()]
    if hist:
        # Los más recientes pesan más.
        blob = " ".join(hist[-6:])
        h_lang, h_conf = detect_text_language(blob)
        if h_lang and h_conf >= 40:
            return h_lang, conf < 50

    if stored_norm:
        return stored_norm, False
    if lang:
        return lang, False
    return "es", False


def bilingual_identity() -> str:
    """El agente es nativo en ES y EN: entiende ambos; el lock solo fija el idioma de salida."""
    return (
        "BILINGUAL MASTERY / DOMINIO BILINGÜE (siempre activo):\n"
        "- You are natively fluent in Spanish AND English — same level of understanding and writing.\n"
        "- Eres nativo en español E inglés: entiendes y escribes ambos al mismo nivel.\n"
        "- Understand the user in Spanish, English, or a mix. Never say you do not speak one of them.\n"
        "- Entiende al usuario en español, inglés o mezclado. Nunca digas que no hablas uno de los dos.\n"
        "- Names, emails, companies and IDs are language-neutral: copy them exactly as written.\n"
        "- Nombres, emails, empresas e IDs son neutros: cópialos tal cual.\n"
        "- Tools/RAG may be in ES or EN; you understand both and still reply in the user's language.\n"
        "- Tools y RAG pueden estar en ES o EN; los entiendes y respondes en el idioma del usuario.\n\n"
    )


def language_lock(lang: Lang) -> str:
    identity = bilingual_identity()
    if lang == "en":
        return identity + (
            "OUTPUT LANGUAGE THIS TURN: ENGLISH.\n"
            "- The user is communicating in ENGLISH (or English is dominant).\n"
            "- Reply ONLY in English. Do not switch to Spanish in the user-facing text.\n"
            "- If a tool/note is in Spanish, rewrite it in natural English.\n"
            "- If the user later writes in Spanish, follow them; this turn stays English.\n\n"
        )
    return identity + (
        "IDIOMA DE SALIDA DE ESTE TURNO: ESPAÑOL.\n"
        "- El usuario se comunica en ESPAÑOL (o el español es dominante).\n"
        "- Responde SOLO en español. No pases a inglés en el texto al usuario.\n"
        "- Si una tool/nota viene en inglés, reescríbela en español natural.\n"
        "- Si más adelante el usuario escribe en inglés, síguelo; este turno queda en español.\n\n"
    )


def user_copy(key: str, lang: Lang) -> str:
    copies = {
        "unavailable": {
            "es": "No pude completar la respuesta en este momento. Inténtalo de nuevo en unos minutos.",
            "en": "I couldn't complete the reply just now. Please try again in a few minutes.",
        },
        "processed": {
            "es": "He procesado tu solicitud correctamente.",
            "en": "I've processed your request.",
        },
        "guardrail": {
            "es": "Disculpa, tu mensaje contiene instrucciones no permitidas y ha sido bloqueado por razones de seguridad.",
            "en": "Sorry, your message contains disallowed instructions and was blocked for security reasons.",
        },
        "hitl": {
            "es": "La operación '{tool}' requiere aprobación previa por parte de un supervisor humano.",
            "en": "The operation '{tool}' requires prior approval from a human supervisor.",
        },
        "escalated_suffix": {
            "es": "Un operador te atenderá en breve por esta conversación.",
            "en": "A human operator will continue with you in this conversation shortly.",
        },
    }
    return copies.get(key, {}).get(lang) or copies.get(key, {}).get("es") or ""


def looks_spanish(texto: str) -> bool:
    lang, conf = detect_text_language(texto)
    return lang == "es" and conf >= 40
