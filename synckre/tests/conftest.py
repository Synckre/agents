import os

import pytest

# Configuración de tests: se define ANTES de importar api.main para que
# pydantic-settings lea estas variables (las env vars ganan a .env).
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DEEPSEEK_API_KEY", "sk-test-0123456789abcdef")
os.environ.setdefault("API_KEYS", "test-key-1,test-key-2")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("CHECKPOINTER_BACKEND", "memory")
os.environ.setdefault("RATE_LIMIT", "10/minute")
os.environ.setdefault("BODY_LIMIT_BYTES", "1000")
os.environ.setdefault("MAX_MENSAJE_LENGTH", "4000")
os.environ.setdefault("TRUSTED_HOSTS", "testserver,localhost")


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"
