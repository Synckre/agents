"""Configuración centralizada vía pydantic-settings (fail-fast).

Todas las secrets (DEEPSEEK_API_KEY, API_KEYS, DATABASE_URL, LANGSMITH_API_KEY)
se leen desde variables de entorno / .env. Si falta alguna requerida, la app
no arranca (ValidationError al instanciar Settings).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

CsvList = Annotated[list[str], NoDecode]


def _split_csv(value: Any) -> Any:
    """Convierte 'a, b, c' en ['a', 'b', 'c'] (para vars tipo lista)."""
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


def _hostname_only(value: str) -> str:
    """Quita esquema, path y puerto de un host (p. ej. https://x.com:443/ → x.com)."""
    for prefix in ("https://", "http://"):
        if value.startswith(prefix):
            value = value[len(prefix) :]
    return value.split("/")[0].split(":")[0]


class Settings(BaseSettings):
    """Variables de entorno del servicio."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Secretos requeridos (fail-fast si faltan) ---
    deepseek_api_key: str = Field(min_length=8, description="API key de DeepSeek.")
    api_keys: CsvList = Field(
        min_length=1,
        description="API keys válidas para X-API-Key, separadas por coma (permite rotación sin downtime).",
    )
    database_url: str = Field(
        min_length=10, description="Connection string postgresql:// del checkpointer."
    )

    # --- Opcionales ---
    app_env: str = "development"
    langsmith_api_key: str | None = None
    cors_origins: CsvList = Field(
        default_factory=list,
        description="Orígenes permitidos (CORS), separados por coma.",
    )
    trusted_hosts: CsvList = Field(
        default_factory=list,
        description="Hosts permitidos (TrustedHost), separados por coma.",
    )
    forwarded_allow_ips: str = "127.0.0.1"
    rate_limit: str = "20/minute"
    body_limit_bytes: int = 1_000_000
    llm_timeout_seconds: float = 60.0
    max_mensaje_length: int = 4000
    max_thread_id_length: int = 128
    checkpointer_backend: str = "postgres"
    log_level: str = "INFO"
    copilotkit_enabled: bool = Field(
        default=True,
        description=(
            "Expone el grafo como runtime CopilotKit en /copilotkit. El endpoint "
            "es público (como /health): la UI de CopilotKit no envía X-API-Key."
        ),
    )

    _split_lists = field_validator(
        "api_keys", "cors_origins", "trusted_hosts", mode="before"
    )(_split_csv)

    @field_validator("trusted_hosts")
    @classmethod
    def _normalize_hosts(cls, value: list[str]) -> list[str]:
        """Normaliza hosts (acepta URLs completas de Coolify como SERVICE_URL_*)."""
        return [_hostname_only(host) for host in value if host]

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        """Valida que DATABASE_URL sea una URL de Postgres."""
        if not (value.startswith("postgres://") or value.startswith("postgresql://")):
            raise ValueError("DATABASE_URL debe ser una URL postgresql://")
        return value

    @property
    def is_production(self) -> bool:
        """True si la app corre en producción."""
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Carga y cachea la configuración; lanza ValidationError si falta algo requerido."""
    return Settings()  # type: ignore[call-arg]  # pydantic-settings construye desde env/.env
