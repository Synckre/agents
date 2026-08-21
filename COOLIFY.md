# Guía de Despliegue en Coolify — AgentSynckre

Este documento detalla la configuración y despliegue del proyecto **AgentSynckre** en **Coolify** (v4+), soportando tanto el despliegue automático mediante **Docker Compose** como el despliegue de **servicios individuales**.

---

## Opciones de Despliegue en Coolify

Existen **dos formas** principales de desplegar AgentSynckre en Coolify:

---

### Opción 1: Despliegue Completo mediante Docker Compose (Recomendado)

Esta opción despliega todo el stack (`frontend`, `api`, `postgres`, `ollama`) automáticamente en un solo proyecto de Coolify.

#### Pasos en Coolify:
1. Ve a **Projects** → Selecciona o crea tu proyecto → **+ Add Resource**.
2. Selecciona **Docker Compose**.
3. Elige tu proveedor de Git (GitHub / GitLab / Git Repository URL) y selecciona el repositorio de `AgentSynckre`.
4. En **Branch**, selecciona `main` (o tu rama de producción).
5. Coolify detectará automáticamente el archivo `docker-compose.yml` en la raíz.
6. En la pestaña **Environment Variables** de Coolify, añade tus credenciales (ver sección *Variables de Entorno*).
7. Haz clic en **Deploy**.

---

### Opción 2: Despliegue de Servicios Individuales

Si prefieres separar los servicios en Coolify o conectar a una base de datos PostgreSQL gestionada externa:

#### Servicio 1: API (FastAPI Backend)
- **Resource Type**: Application (Docker File)
- **Base Directory**: `/` (raíz del repo: el Dockerfile hace `COPY apps/api/...`)
- **Dockerfile Location**: `apps/api/Dockerfile`
- **Port**: `8000`
- **Healthcheck Path**: `/healthz` (liveness, sin DB). No uses `/api/v1/health` para Traefik: si Postgres tarda, Coolify marca *unhealthy* y el dominio responde `no available server`.

#### Servicio 2: Web (Next.js Control Center)
- **Resource Type**: Application (Docker File)
- **Base Directory**: `/apps/web`
- **Dockerfile Location**: `/Dockerfile` (o `apps/web/Dockerfile`)
- **Port**: `3000`
- **Build Arguments**:
  - `NEXT_PUBLIC_API_URL`: URL pública de la API (ej. `https://agent.synckre.com`). El navegador ya no la usa (same-origin `/api/v1`); sí hace falta `API_URL` en runtime.
  - `API_URL`: URL del backend FastAPI que el proxy de Next llama en servidor (interna de Docker o `https://agent.synckre.com`). **No** pongas aquí la URL del propio frontend.
  - `NEXT_PUBLIC_INTERNAL_API_KEY`: Tu clave `INTERNAL_API_KEY`

---

## Variables de Entorno para Coolify

Configura las siguientes variables en la sección **Environment Variables** del recurso en Coolify:

| Variable | Descripción | Ejemplo / Valor |
|---|---|---|
| `ENV` | Entorno de ejecución | `production` |
| `COMPANY_NAME` | Nombre legal de la empresa | `Synckre` |
| `DEEPSEEK_API_KEY` | Clave API de DeepSeek | `sk-...` |
| `DEEPSEEK_MODEL` | Modelo de DeepSeek | `deepseek-v4-flash` |
| `PUBLIC_API_KEY` | Clave para sitio web/clientes públicos | Generar string seguro |
| `INTERNAL_API_KEY` | Clave para empleados/dashboard web | Generar string seguro |
| `ADMIN_API_KEY` | Clave administrativa backend | Generar string seguro |
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos (separados por coma) | `https://control-ai.synckre.com,https://www.synckre.com` |
| `POSTGRES_USER` | Usuario de PostgreSQL | `postgres` |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL | Generar contraseña segura |
| `POSTGRES_DB` | Nombre de la base de datos | `langgraph_db` |
| `POSTGRES_URI` | String de conexión (opcional si usas variables individuales) | `postgresql://postgres:pass@postgres:5432/langgraph_db` |
| `OLLAMA_BASE_URL` | URL del servicio Ollama RAG | `http://ollama:11434` |
| `RESEND_API_KEY` | Clave de Resend para envío de emails (opcional) | `re_...` |

---

## Solución de Problemas Comunes en Coolify

0. **Error: `Invalid template: "postgresql://${POSTGRES_USER:-postgres"` (falla al leer build-time.env)**:
   - **Causa**: algún valor de variable en Coolify usa la sintaxis de plantilla `${VAR:-default}` del `docker-compose.yml` (típicamente `POSTGRES_URI` copiada del compose). Coolify interpreta `${...}` como plantilla y falla.
   - **Solución**: pon **valores concretos** en Coolify, nunca `${...}`. En especial:
     - `POSTGRES_URI=postgresql://usuario:password@host:5432/base` (URI real, sin `${}`)
     - `INTERNAL_API_KEY`, `ADMIN_API_KEY`, `PUBLIC_API_KEY`, `DEEPSEEK_API_KEY` → valores fijos generados.
   - Si usas la **Opción 1 (docker-compose)**, las variables con `${...:-...}` son válidas porque las interpola el propio compose; el problema solo aparece en la **Opción 2 (servicios individuales)**.

1. **Error: `COPY failed: file not found` durante la compilación en Coolify**:
   - **Causa**: Coolify usó la raíz del repositorio como contexto de compilación en lugar de la subcarpeta del servicio.
   - **Solución**: En la configuración del servicio de Coolify, establece **Base Directory** en `/apps/api` para el backend y `/apps/web` para el frontend.

1b. **Error: `failed to read dockerfile: open Dockerfile: no such file or directory` (target api/frontend)**:
   - **Causa**: el **Dockerfile Location** no coincide con el Base Directory. Ej.: Base Directory = raíz del repo y Dockerfile Location = `/Dockerfile`, cuando el Dockerfile está en `apps/web/Dockerfile`.
   - **Solución**: pon **Base Directory = `/apps/web`** (o `/apps/api`) y **Dockerfile Location = `/Dockerfile`** (relativo al Base Directory). Si prefieres Base Directory = raíz, usa `apps/web/Dockerfile` como Dockerfile Location.

1c. **Avisos `The "POSTGRES_HOST" variable is not set` / `POSTGRES_PORT`**:
   - **Causa**: la URI de la BD se arma con variables de plantilla de Coolify sin valor.
   - **Solución**: define `POSTGRES_HOST=postgres` y `POSTGRES_PORT=5432` (o usa `POSTGRES_URI` con una URI completa y concreta).

2. **El contenedor API aparece como `unhealthy` / el dominio responde `no available server`**:
   - **Causa**: Traefik solo enruta a contenedores *healthy*. Si el healthcheck pega a `/api/v1/health` y ese handler espera Postgres/Ollama (o un `x-api-key`), el check falla, Coolify saca el contenedor y el proxy responde `503 no available server`.
   - **Solución**: Healthcheck Path = `/healthz` (o `/api/v1/live`). Puerto **8000**. Reinicia el recurso API y mira logs de arranque (import error, Postgres, crash loop). El proceso tiene que estar *running* y *healthy* para que `https://agent.synckre.com` deje de devolver 503.

3. **CORS Error desde el Dashboard (`control-ai.synckre.com` → `agent.synckre.com`)**:
   - **Causa frecuente**: Traefik/Coolify responde `503 no available server` (API caída o unhealthy). Ese 503 **no lleva** `Access-Control-Allow-Origin`, y el navegador lo reporta como CORS.
   - **Solución**:
     1. Reinicia el servicio API hasta que `/api/v1/health` responda 200 (no 503).
     2. Añade `https://control-ai.synckre.com` a `ALLOWED_ORIGINS` en Coolify.
     3. En el frontend, define `API_URL` hacia el backend (no hacia `control-ai`). El dashboard llama same-origin `/api/v1` y Next hace de proxy.
