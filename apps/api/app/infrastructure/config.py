"""
Configuración Global de Synckre Agent V2.
Carga variables de entorno para DeepSeek (deepseek-v4-flash), PostgreSQL, Ollama RAG,
Temporal y servicios de integración (Resend, Google Calendar, ERPNext).
"""

import os
from pathlib import Path
from typing import List, Optional
from dotenv import load_dotenv
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

DEEPSEEK_PLACEHOLDER_KEY = "your_deepseek_api_key_here"


class Settings(BaseSettings):
    COMPANY_NAME: str = os.getenv("COMPANY_NAME", "Synckre")

    # DeepSeek Config
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

    # Database Credentials & Connection
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "postgres")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "postgres")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5432")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "langgraph_db")
    POSTGRES_URI: str = os.getenv(
        "POSTGRES_URI",
        f"postgresql://{os.getenv('POSTGRES_USER', 'postgres')}:{os.getenv('POSTGRES_PASSWORD', 'postgres')}@{os.getenv('POSTGRES_HOST', 'postgres')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB', 'langgraph_db')}",
    )

    ENV: str = os.getenv("ENV", "dev")

    # Clerk — issuer fijado (no se acepta cualquier tenant).
    CLERK_ISSUER: str = os.getenv("CLERK_ISSUER", "")
    CLERK_PUBLISHABLE_KEY: str = os.getenv(
        "CLERK_PUBLISHABLE_KEY",
        os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", ""),
    )
    CLERK_AUTHORIZED_PARTIES: str = os.getenv(
        "CLERK_AUTHORIZED_PARTIES",
        "https://control-ai.synckre.com,http://localhost:3000,http://127.0.0.1:3000",
    )

    # CORS — localhost + Control Center de producción.
    # También se aceptan orígenes https://*.synckre.com vía regex en main.py.
    ALLOWED_ORIGINS: str = os.getenv(
        "ALLOWED_ORIGINS",
        ",".join(
            [
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:8000",
                "http://localhost:4321",
                "http://127.0.0.1:4321",
                "https://control-ai.synckre.com",
                "https://www.synckre.com",
                "https://synckre.com",
            ]
        ),
    )
    ALLOWED_ORIGIN_REGEX: str = os.getenv(
        "ALLOWED_ORIGIN_REGEX",
        r"https://([a-z0-9-]+\.)?synckre\.com",
    )

    # RAG / Ollama Embeddings
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "qwen3-embedding:0.6b")
    EMBEDDING_DIMENSION: int = 1024
    TOP_K: int = int(os.getenv("TOP_K", "4"))

    # Temporal
    TEMPORAL_ADDRESS: str = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")
    TEMPORAL_NAMESPACE: str = os.getenv("TEMPORAL_NAMESPACE", "synckre")
    TASK_QUEUE: str = os.getenv("TASK_QUEUE", "synckre-tasks")

    # Recordatorios automáticos de citas
    APPOINTMENT_REMINDER_MINUTES: int = int(os.getenv("APPOINTMENT_REMINDER_MINUTES", "15"))
    REMINDER_POLL_SECONDS: int = int(os.getenv("REMINDER_POLL_SECONDS", "60"))

    # External Integrations
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "resend")
    EMAIL_FROM: str = os.getenv("EMAIL_FROM", "soporte@synckre.com")
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY", "")

    GOOGLE_CALENDAR_ID: str = os.getenv("GOOGLE_CALENDAR_ID", "")
    GOOGLE_SERVICE_ACCOUNT_JSON: str = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    GOOGLE_SERVICE_ACCOUNT_FILE: str = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "")

    EMAIL_INTERNAL_TO: str = os.getenv("EMAIL_INTERNAL_TO", "operaciones@synckre.com")
    ERPNEXT_URL: str = os.getenv("ERPNEXT_URL", "")
    ERPNEXT_API_KEY: str = os.getenv("ERPNEXT_API_KEY", "")
    ERPNEXT_API_SECRET: str = os.getenv("ERPNEXT_API_SECRET", "")
    # Nombre del Google Calendar en ERPNext (si está vacío, se descubre automáticamente)
    ERPNEXT_GOOGLE_CALENDAR: str = os.getenv("ERPNEXT_GOOGLE_CALENDAR", "")

    SKIP_LLM_KEY_CHECK: bool = os.getenv("SKIP_LLM_KEY_CHECK", "").lower() in {
        "1",
        "true",
        "yes",
    }

    model_config = SettingsConfigDict(
        env_file=str(_REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def clerk_authorized_parties_list(self) -> List[str]:
        return [p.strip().rstrip("/") for p in self.CLERK_AUTHORIZED_PARTIES.split(",") if p.strip()]

    @property
    def is_production(self) -> bool:
        return (self.ENV or "").strip().lower() in {"prod", "production"}

    @model_validator(mode="after")
    def _validate_deepseek_api_key(self):
        if self.SKIP_LLM_KEY_CHECK:
            return self
        key = (self.DEEPSEEK_API_KEY or "").strip()
        if not key or key == DEEPSEEK_PLACEHOLDER_KEY:
            # En entorno de dev/test podemos avisar en log sin romper si SKIP_LLM_KEY_CHECK no está activo
            pass
        return self


settings = Settings()
