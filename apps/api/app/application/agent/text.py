"""Utilidades de texto del agente (sin I/O)."""

from __future__ import annotations

import re

_INTERNO_RE = re.compile(
    r"\b(?:CRM-)?LEAD-\d+\b|\bEV\d+\b|ISS-\d+\b|"
    r"\b(?:TSK|APP|TICK|CONV|SRC|ESC|MSG|TEX)-[A-Za-z0-9]+\b"
)


def redactar_datos_internos(texto: str, reemplazo: str = "") -> str:
    """Elimina o enmascara referencias internas (LEAD-, EV000, ISS-, TSK-, CONV-, etc.)."""
    if not texto:
        return texto
    return _INTERNO_RE.sub(reemplazo, texto)


def limpiar_texto_final(texto: str) -> str:
    texto = redactar_datos_internos(texto, reemplazo="")
    texto = texto.replace("[referencia interna]", "")
    texto = texto.replace("🔖 Referencia:", "").replace("🔖Referencia:", "")
    texto = re.sub(r"\s*Referencia:\s*", " ", texto)
    texto = re.sub(r"\.\s+\.", ".", texto)
    texto = re.sub(r"\s{2,}", " ", texto).strip()
    return texto
