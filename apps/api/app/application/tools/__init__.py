"""Compat: las tools viven en infrastructure. Importar registra el registry."""

from app.infrastructure.tools import *  # noqa: F403
from app.infrastructure.tools import __all__ as __all__  # noqa: F401
