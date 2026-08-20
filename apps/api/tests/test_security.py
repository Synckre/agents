"""
Tests de Seguridad y Aislamiento de RAG / API Keys en Synckre Agent V2.
"""

import pytest
from app.infrastructure.config import settings
from app.interfaces.security import resolve_domain


def test_api_key_domain_resolution():
    # Test resolución de API keys según las Settings activas
    if settings.ADMIN_API_KEY:
        assert resolve_domain(settings.ADMIN_API_KEY) == "admin"
    if settings.INTERNAL_API_KEY:
        assert resolve_domain(settings.INTERNAL_API_KEY) == "internal"
    if settings.PUBLIC_API_KEY:
        assert resolve_domain(settings.PUBLIC_API_KEY) == "public"

    assert resolve_domain("invalid-key-xyz-99999") is None
