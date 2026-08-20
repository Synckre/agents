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
- **Base Directory**: `/apps/api`
- **Dockerfile Location**: `/Dockerfile` (o `apps/api/Dockerfile`)
- **Port**: `8000`
- **Healthcheck Path**: `/api/v1/health`

#### Servicio 2: Web (Next.js Control Center)
- **Resource Type**: Application (Docker File)
- **Base Directory**: `/apps/web`
- **Dockerfile Location**: `/Dockerfile` (o `apps/web/Dockerfile`)
- **Port**: `3000`
- **Build Arguments**:
  - `NEXT_PUBLIC_API_URL`: URL pública de la API (ej. `https://api.tu-dominio.com`)
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
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos (separados por coma) | `https://www.synckre.com,https://api.synckre.com` |
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

2. **El contenedor API aparece como `unhealthy`**:
   - **Causa**: el healthcheck de Coolify hace un GET plano a `/api/v1/health`, pero ese endpoint **exige la key** (`x-api-key`) y devolvería 401.
   - **Solución**: el Dockerfile de la API ya incluye un `HEALTHCHECK` que envía `x-api-key: $INTERNAL_API_KEY` (Coolify lo respeta). Si usas el healthcheck HTTP de Coolify, configura el header `x-api-key` con tu `INTERNAL_API_KEY`, o deja que Coolify use el healthcheck del Dockerfile.

3. **CORS Error desde la web de Astro o Dashboard**:
   - **Solución**: Añade la URL completa de tu frontend (ej. `https://www.synckre.com`) a la variable `ALLOWED_ORIGINS` en las variables de entorno de Coolify.
