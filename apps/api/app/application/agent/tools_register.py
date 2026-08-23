"""Registro explícito de herramientas. Llamar desde el composition root y tests."""

from __future__ import annotations

_REGISTERED = False


def register_all_tools() -> None:
    global _REGISTERED
    if _REGISTERED:
        return
    import app.infrastructure.tools  # noqa: F401

    _REGISTERED = True
