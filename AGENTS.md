# Synckre Agent V2 — Enterprise Agent Runtime

Plataforma empresarial de agentes autónomos para Synckre.
Arquitectura V2: **Monorepo + Clean Architecture (dominio → aplicación → infraestructura → interfaces)**.

## Estructura del Repositorio
```
AgentSynckre/
├── apps/
│   ├── api/                 # FastAPI + AgentRuntime + Tools + RAG + Recordatorios (:8000)
│   │   └── app/
│   │       ├── domain/          # Entidades y reglas de negocio (sin dependencias)
│   │       ├── application/     # Casos de uso: agent/, tasks/, tools/, services/
│   │       ├── infrastructure/  # Adaptadores: db/, integrations/ (ERPNext, Resend, Calendar), rag/, config
│   │       └── interfaces/      # Entrada HTTP: api/v1/, main.py, security.py
│   └── web/                 # Next.js Control Center Dashboard (:3000)
├── documents/               # Documentos RAG por dominio (public/ e internal/)
├── docker/                  # Scripts auxiliares de Docker
└── docker-compose.yml
```

## Comandos Principales
Desde la **raíz del repo** (`.env` también en la raíz):
- Stack completo: `docker compose up -d --build`
  - Frontend: `http://localhost:3000`
  - Backend API: `http://localhost:8000`
- Ingesta RAG: `python apps/api/scripts/ingest.py --domain public` (o `internal`)
- Dev local Backend:
  ```bash
  cd apps/api
  PYTHONPATH="$PWD" uvicorn app.interfaces.main:app --reload --port 8000
  ```
- Dev local Frontend:
  ```bash
  cd apps/web && pnpm dev
  ```
- Tests Backend:
  ```bash
  cd apps/api && PYTHONPATH="$PWD" pytest -v
  ```

## Arquitectura (Clean Architecture en `apps/api/app`)
Regla de dependencia: **hacia adentro**. `domain` no importa nada del resto; `infrastructure` no importa `application`/`interfaces`; `interfaces` (main) compone todo.

- `domain/` — entidades puras (Pydantic) y enums: `ConversationModel`, `TaskModel`, `TaskStatus`, etc.
- `application/` — casos de uso:
  - `agent/runtime.py` — `AgentRuntime` conversacional inmediato (loop del agente).
  - `agent/roles.py` & `policies.py` — roles y evaluación de capacidades y políticas.
  - `agent/tools_registry.py` & `tools/` — registro centralizado de herramientas (Calendar/ERPNext, CRM, Soporte, Documentos, Comunicación).
  - `tasks/service.py` — máquina de estados de tareas y aprobaciones Human-in-the-Loop.
  - `services/reminder_scheduler.py` — recordatorios automáticos de citas (1 día y minutos antes).
- `infrastructure/` — adaptadores:
  - `db/` — PostgreSQL/pgvector (manager, schema).
  - `integrations/` — ERPNext, Resend/SendGrid, Google Calendar, plantillas de correo.
  - `rag/service.py` — ingesta y búsqueda vectorial aislada con Ollama (1024 dims).
  - `config.py` — settings centralizados.
- `interfaces/` — entrada HTTP: routers `api/v1/` (conversaciones, tasks, approvals, audit, knowledge, calendar, analytics, business), `main.py` (composición raíz + lifespan con scheduler) y `security.py` (x-api-key).

## Convenciones
- Docstrings/logs/prompts en **español**; identificadores en inglés.
- `domain` y `application` no hacen llamadas de red directas a servicios externos: usan `infrastructure` (adaptadores).
- PYTHONPATH de desarrollo: `apps/api`.
