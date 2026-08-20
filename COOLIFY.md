# Despliegue con Coolify

El proyecto es compatible con **Coolify** (PaaS self-hosted). Cada aplicación se despliega
por separado usando su propio `Dockerfile`; las variables de entorno se configuran en la
UI de Coolify (y las `NEXT_PUBLIC_*` como variables de **build**).

## Arquitectura

| App | Carpeta | Dockerfile | Puerto | Healthcheck |
|-----|---------|-----------|--------|-------------|
| **api** | `apps/api` | `Dockerfile` | 8000 | `/api/v1/health` con header `x-api-key` |
| **web** | `apps/web` | `Dockerfile` | 3000 | TCP / puerto 3000 |
| **postgres** | servicio de Coolify (pgvector) | — | 5432 | estándar |
| **ollama** *(opcional)* | recurso de Coolify o externo | — | 11434 | — |

## 1. Base de datos (Postgres con pgvector)

Crea un recurso **PostgreSQL** en Coolify. El esquema (`synckre.*`) se crea solo al
arrancar la API, no hace falta importar nada. Necesitarás la URI de conexión para
`POSTGRES_URI`.

> Si Coolify no ofrece pgvector, usa una imagen `pgvector/pgvector:pg16` como recurso Docker.

## 2. API (`apps/api`)

- **Build**: Dockerfile estándar (multi-stage). Imagen `python:3.12-slim` + uvicorn.
- **Puerto**: 8000.
- **Healthcheck**: el Dockerfile incluye un `HEALTHCHECK` que consulta
  `/api/v1/health` con `x-api-key: $INTERNAL_API_KEY`. Coolify lo respeta; si prefieres
  el check HTTP de Coolify, apunta a `/api/v1/health` y configura el header `x-api-key`.

**Variables de entorno requeridas:**

| Variable | Descripción |
|----------|-------------|
| `POSTGRES_URI` | URI de la base (ej. `postgresql://user:pass@host:5432/db`) |
| `PUBLIC_API_KEY` | Key de nivel público (genera con `openssl rand -hex 32`) |
| `INTERNAL_API_KEY` | Key de nivel interno (la usa el frontend y el healthcheck) |
| `ADMIN_API_KEY` | Key de nivel admin (ingesta RAG) |
| `DEEPSEEK_API_KEY` | Clave de DeepSeek (LLM) |
| `RESEND_API_KEY` | Clave de Resend (emails) |
| `EMAIL_FROM` | Remitente de los correos |
| `ERPNEXT_URL` / `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` | ERPNext (opcional pero recomendado) |

**Opcionales:**

| Variable | Descripción |
|----------|-------------|
| `OLLAMA_BASE_URL` | Ollama para embeddings/RAG (si no se usa, la búsqueda RAG queda degradada) |
| `BUSINESS_DAYS` / `BUSINESS_HOURS` / `BUSINESS_TIMEZONE` / `APPOINTMENT_DURATION_MINUTES` | Disponibilidad de la agenda (fallback) |
| `GOOGLE_CALENDAR_ID` / `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Calendar (fallback de citas) |
| `ALLOWED_ORIGINS` | Orígenes CORS del frontend |
| `ENV` | `production` |

## 3. Frontend (`apps/web`)

- **Build**: Dockerfile multi-stage. **Las `NEXT_PUBLIC_*` se hornean en el build**:
  configúralas como **variables de build** en Coolify.
- **Puerto**: 3000.

**Variables de build:**

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | URL pública de la API (ej. `https://api.dominio.com`) |
| `NEXT_PUBLIC_INTERNAL_API_KEY` | Debe coincidir con `INTERNAL_API_KEY` de la API |

**Variables de runtime:**

| Variable | Descripción |
|----------|-------------|
| `API_URL` | URL interna de la API **vista desde el contenedor web** (ej. `http://api:8000` si comparten red de Coolify) — la usa el route handler de login |

## 4. Red entre apps

En Coolify, añade **api** y **web** a la **misma red** (p.ej. la red por defecto del
proyecto). Así `API_URL=http://<nombre-del-recurso-api>:8000` funciona desde el
contenedor web, y la API alcanza la BD por su host de Coolify.

## Notas

- **CORS**: `ALLOWED_ORIGINS` debe incluir el dominio del frontend (ej. `https://web.dominio.com`).
- **RAG sin Ollama**: la app arranca y funciona, pero las búsquedas de conocimiento y la
  ingesta de documentos quedarán sin resultados (Ollama solo para embeddings).
- **Variables secretas**: usa los secretos de Coolify para `*_API_KEY` y `*_SECRET`.
- **Actualizaciones**: con Git pull + rebuild en Coolify, o el webhook del repo.
