"""Valores literales que escribió el usuario. El LLM no es fuente de identidad."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Dict, List, Sequence

# ASCII a propósito: `\w` en Python 3 es Unicode y recorta o inventa bordes.
# Captura el substring TAL CUAL (sin lower, sin quitar puntos internos).
_EMAIL = re.compile(
    r"(?<![A-Za-z0-9._%+-])"
    r"("
    r"[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,63}[A-Za-z0-9])?"
    r"@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"[A-Za-z]{2,24}"
    r")"
    r"(?![A-Za-z0-9._%+-])"
)
_NAME = re.compile(
    r"(?:soy|me llamo|mi nombre es|mi nombre:)\s*"
    r"([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]{0,60})",
    re.IGNORECASE,
)
_COMPANY = re.compile(
    r"(?:empresa|compañía|compania|company|de la empresa)\s*"
    r"(?:llamada|llamado|es|:|se llama)?\s*"
    r"([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][\wÁÉÍÓÚÜÑáéíóúüñ .&-]{0,60})",
    re.IGNORECASE,
)
_PHONE = re.compile(r"(\+?\d[\d\s\-()]{7,}\d)")

_SEP_NOMBRE = (",", ";", " y ", " mi ", " me ", " trabajo")
_SEP_EMPRESA = (",", ";", " mi ", " me ", " mi tel", " teléfono", " telefono")

_EMAIL_KEYS = {
    "email",
    "email_nuevo",
    "email_actual",
    "destinatario",
    "cliente_email",
    "aprobador_email",
    "client_email",
}
_NAME_KEYS = {"nombre", "name", "cliente_nombre"}
_COMPANY_KEYS = {"empresa", "company", "company_name"}
_PHONE_KEYS = {"telefono", "teléfono", "phone", "mobile", "mobile_no", "tel"}


@dataclass
class ContactSnapshot:
    email: str = ""
    name: str = ""
    company: str = ""
    phone: str = ""
    emails: List[str] = field(default_factory=list)


def _acotar(valor: str, separadores: tuple[str, ...]) -> str:
    for sep in separadores:
        idx = valor.lower().find(sep)
        if idx > 0:
            valor = valor[:idx]
    return valor.strip().rstrip(".")


def extraer_emails(texto: str) -> List[str]:
    """Emails exactos en el texto, en orden. No se normaliza el local-part."""
    return [m.group(1) for m in _EMAIL.finditer(texto or "")]


def extraer_datos(texto: str) -> Dict[str, str]:
    """Campos de identidad copiados del texto del usuario (último email si hay varios)."""
    texto = texto or ""
    datos: Dict[str, str] = {}
    emails = extraer_emails(texto)
    if emails:
        datos["email"] = emails[-1]

    match = _NAME.search(texto)
    if match:
        nombre = _acotar(match.group(1), _SEP_NOMBRE)
        if nombre and "@" not in nombre:
            datos["name"] = nombre

    match = _COMPANY.search(texto)
    if match:
        empresa = _acotar(match.group(1), _SEP_EMPRESA)
        if empresa and "@" not in empresa and empresa.lower() not in ("mi", "su", "tu", "la", "el"):
            datos["company"] = empresa

    match = _PHONE.search(texto)
    if match:
        datos["phone"] = match.group(1).strip()
    return datos


def _norm(valor: str) -> str:
    return re.sub(r"\s+", "", valor or "").casefold()


def _es_typo(candidato: str, verbatim: str, umbral: float = 0.84) -> bool:
    if not candidato or not verbatim:
        return False
    a, b = _norm(candidato), _norm(verbatim)
    if a == b:
        return True
    return SequenceMatcher(None, a, b).ratio() >= umbral


def prefer_verbatim_email(candidato: str, conocido: str) -> str:
    """Si `conocido` es un email literal del usuario, gana frente a un typo del modelo."""
    conocidos = extraer_emails(conocido or "")
    if conocidos:
        canon = conocidos[-1]
        if not candidato or _es_typo(candidato, canon):
            return canon
    extras = extraer_emails(candidato or "")
    return extras[-1] if extras else (candidato or conocido)


def merge_snapshot(base: ContactSnapshot, datos: Dict[str, str]) -> ContactSnapshot:
    if datos.get("email"):
        email = datos["email"]
        if not base.emails or _norm(base.emails[-1]) != _norm(email):
            base.emails.append(email)
        base.email = email
    if datos.get("name"):
        base.name = datos["name"]
    if datos.get("company"):
        base.company = datos["company"]
    if datos.get("phone"):
        base.phone = datos["phone"]
    return base


def snapshot_from_texts(
    texts: Sequence[str],
    *,
    metadata_email: str = "",
) -> ContactSnapshot:
    snap = ContactSnapshot()
    if metadata_email and extraer_emails(metadata_email) == [metadata_email]:
        snap.emails.append(metadata_email)
        snap.email = metadata_email
    for texto in texts:
        merge_snapshot(snap, extraer_datos(texto or ""))
    # Casos: metadata era un typo del LLM persistido; el texto del usuario manda.
    if snap.emails:
        snap.email = snap.emails[-1]
    return snap


async def snapshot_for_turn(conversation_id: str, user_input: str) -> ContactSnapshot:
    from app.infrastructure.db.manager import db_manager

    texts: List[str] = []
    meta_email = ""
    try:
        conv = await db_manager.get_conversation(conversation_id)
        if conv:
            meta_email = str((conv.metadata or {}).get("customer_email") or "")
        mensajes = await db_manager.get_messages(conversation_id, limit=40)
        for m in mensajes or []:
            if getattr(m, "sender", None) == "user":
                texts.append(m.content or "")
    except Exception:
        texts = []
    # El mensaje actual al final (puede no estar aún en DB según el caller).
    if not texts or texts[-1].strip() != (user_input or "").strip():
        texts.append(user_input or "")
    return snapshot_from_texts(texts, metadata_email=meta_email)


def pin_tool_args(args: Dict[str, Any], snap: ContactSnapshot, user_input: str = "") -> Dict[str, Any]:
    """Sustituye identidad del LLM por lo que el usuario escribió literalmente."""
    out = dict(args or {})
    actuales = extraer_emails(user_input)
    emails_hist = list(snap.emails)
    ultimo = actuales[-1] if actuales else snap.email

    if len(actuales) >= 2:
        email_viejo, email_nuevo = actuales[-2], actuales[-1]
    elif actuales:
        email_nuevo = actuales[0]
        email_viejo = next(
            (e for e in reversed(emails_hist[:-1]) if _norm(e) != _norm(email_nuevo)),
            snap.email if _norm(snap.email) != _norm(email_nuevo) else "",
        )
    else:
        email_nuevo = ultimo
        email_viejo = snap.email

    for key, val in list(out.items()):
        if not isinstance(val, str):
            continue
        kl = key.lower()
        if kl in {"email", "cliente_email", "client_email"} and ultimo:
            out[key] = ultimo
        elif kl == "email_nuevo" and email_nuevo:
            out[key] = email_nuevo
        elif kl == "email_actual" and email_viejo:
            out[key] = email_viejo
        elif kl in {"destinatario", "aprobador_email"} and ultimo and val and _es_typo(val, ultimo):
            out[key] = ultimo
        elif kl in _NAME_KEYS and snap.name:
            out[key] = snap.name
        elif kl in _COMPANY_KEYS and snap.company:
            out[key] = snap.company
        elif kl in _PHONE_KEYS and snap.phone:
            out[key] = snap.phone
        elif "@" in (val or "") and ultimo and _es_typo(val, ultimo):
            out[key] = ultimo

    identidad = {"nombre", "name", "email", "mensaje", "motivo", "empresa", "telefono"}
    if ultimo and (identidad & set(out)):
        out.setdefault("email", ultimo)
    if "email_nuevo" in out and email_nuevo:
        out["email_nuevo"] = email_nuevo
    if snap.name and ("nombre" in out or "name" in out):
        out.setdefault("nombre", snap.name)
    if snap.phone and ("telefono" in out or "phone" in out):
        out.setdefault("telefono", snap.phone)
    if snap.company and "empresa" in out:
        out.setdefault("empresa", snap.company)
    return out
