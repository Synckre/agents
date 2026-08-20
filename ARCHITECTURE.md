# Synckre Agent V2 — Arquitectura

**Versión:** 2.3.0 · **Fecha:** 17 de Agosto, 2026

---

## 1. Principios

El repositorio es un **monorepo** con dos aplicaciones (`apps/api`, `apps/web`) y aplica
**Clean Architecture** en el backend: la regla de dependencia apunta **hacia adentro**
(domain ← application ← infrastructure ← interfaces). `domain` no conoce nada del resto;
`infrastructure` no importa casos de uso; `interfaces` (main) compone todo.

## 2. Estructura del Repositorio

```text
AgentSynckre/
├── apps/
│   ├── api/                          # FastAPI — Agent Runtime (puerto 8000)
│   │   ├── app/
│   │   │   ├── domain/               # Entidades puras + enums (sin dependencias)
│   │   │   ├── application/          # Casos de uso
│   │   │   │   ├── agent/            #   runtime, roles, policies, memory, tools_registry
│   │   │   │   ├── tasks/            #   máquina de estados + HITL
│   │   │   │   ├── tools/            #   herramientas (calendario/ERP, CRM, soporte, docs, comunicación)
│   │   │   │   └── services/         #   reminder_scheduler
│   │   │   ├── infrastructure/       # Adaptadores
│   │   │   │   ├── db/               #   Postgres/pgvector (manager, schema)
│   │   │   │   ├── integrations/     #   ERPNext, Resend/SendGrid, Google Calendar, plantillas
│   │   │   │   ├── rag/              #   embeddings + búsqueda vectorial
│   │   │   │   └── config.py         #   settings
│   │   │   └── interfaces/           # Entrada HTTP
│   │   │       ├── api/v1/           #   routers (conversations, tasks, approvals, audit, knowledge, calendar, analytics, business, health)
│   │   │       ├── main.py           #   composición raíz + lifespan (scheduler)
│   │   │       └── security.py       #   autenticación x-api-key
│   │   ├── tests/  scripts/  Dockerfile  requirements.txt
│   └── web/                          # Next.js Control Center (puerto 3000)
│       ├── app/                      #   rutas (/dashboard, /conversations, /workflows, /knowledge, /agents, /audit, /settings)
│       ├── components/               #   UI + shadcn (ui/*) + PageHeader, Sidebar, Markdown, ThinkingTimeline
│       ├── hooks/  lib/  types/      #   useApiStatus, cliente API, tipos
├── documents/                        # PDFs de conocimiento RAG
├── docker/                           # scripts Postgres/Ollama
├── docker-compose.yml                # web + api + postgres + ollama
└── AGENTS.md
```

## 3. Flujo de Datos (Agenda + Recordatorios)

```text
Cliente → Conversación → AgentRuntime (application/agent)
   ├─ create_event ──→ infrastructure/integrations/erp.py (ERPNext Event)
   │                    ├─ email confirmación (Resend, plantilla HTML)
   │                    └─ recordatorios → db (appointment_reminders)
   │                              ↓
   │                    reminder_scheduler (application/services)
   │                    └─ emails: 1 día antes + N minutos antes
   ├─ create_prospect/customer ──→ ERPNext (Lead/Customer) + email verificación
   └─ telemetría → db (audit_logs, tool_executions) → interfaces/api/v1
```

## 4. Reglas de dependencia (Clean Architecture)

| Capa | Puede importar | No puede importar |
|---|---|---|
| `domain` | stdlib, pydantic | nada de `app` |
| `application` | `domain`, `infrastructure` (adaptadores) | `interfaces` |
| `infrastructure` | `domain` | `application`, `interfaces` |
| `interfaces` | todo (compone) | — |

## 5. Matriz de componentes

| Componente | Ubicación | Descripción |
|---|---|---|
| AgentRuntime | `application/agent/runtime.py` | Loop conversacional del agente |
| ToolRegistry | `application/agent/tools_registry.py` | Registro y ejecución de herramientas |
| Tools | `application/tools/*` | Calendario/ERP, CRM, Soporte, Documentos, Comunicación |
| TaskService | `application/tasks/service.py` | Estados de tarea y aprobaciones HITL |
| ReminderScheduler | `application/services/reminder_scheduler.py` | Recordatorios automáticos de citas |
| DB Manager | `infrastructure/db/manager.py` | Persistencia Postgres/pgvector |
| ERPNext / Email / Calendar | `infrastructure/integrations/*` | Adaptadores externos |
| RAG | `infrastructure/rag/service.py` | Embeddings Ollama + pgvector |
| API v1 | `interfaces/api/v1/*` | Endpoints REST |
| Control Center | `apps/web` | Next.js + shadcn + view transitions |
