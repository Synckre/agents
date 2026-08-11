# Synckre Agent

https://smith.langchain.com/studio?baseUrl=http://localhost:8123

Agente multi-agente en LangGraph (Python) con **DeepSeek** como modelo:

- **Grafo supervisor + workers**: un supervisor decide qué worker actúa en cada turno
  (`researcher` / investigador, `writer` / redactor, `coder` / programador) y finaliza
  con `FINISH`.
- **API FastAPI**: `POST /invoke`, `POST /stream` (SSE), `GET /health`,
  `GET /threads/{thread_id}/history`.
- **Persistencia**: checkpointer de LangGraph sobre **Postgres 16**
  (`langgraph-checkpoint-postgres` + pool `psycopg_pool`), con `setup()` en el arranque.
- **Seguridad nivel producción**: API keys con `compare_digest`, rate limiting por key
  (slowapi), CORS whitelist, TrustedHost, headers de seguridad, límite de body,
  logging JSON sin secretos, y errores neutros al cliente.

## Arquitectura

```
src/
├── agent/
│   └── graph.py      # grafo supervisor + workers (build_graph / graph)
└── api/
    ├── main.py       # FastAPI: lifespan (checkpointer) + rutas
    ├── checkpointer.py   # pool Postgres + AsyncPostgresSaver (setup en arranque)
    ├── models.py     # Pydantic estrictos (validación y límites)
    ├── security.py   # auth, rate limit, CORS, TrustedHost, headers, body-limit
    ├── settings.py   # pydantic-settings, fail-fast
    └── logging_conf.py  # structlog JSON + redacción de secretos
```

## Ejecutar localmente

Requisitos: Docker con Compose v2.

```bash
cp .env.example .env          # completa los valores (DEEPSEEK_API_KEY, API_KEYS, ...)
docker compose up --build     # app en http://localhost:8000 + Postgres 16
```

> El override local publica la app y Postgres solo en `127.0.0.1`. El checkpointer
> espera a que Postgres esté sano y crea sus tablas automáticamente en el arranque.

Ejemplos:

```bash
# Healthcheck (sin auth)
curl http://localhost:8000/health

# Invocación síncrona
curl -X POST http://localhost:8000/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <tu-api-key>" \
  -d '{"thread_id": "demo-1", "mensaje": "Escribe una función de Python que calcule el factorial."}'

# Streaming (SSE)
curl -N -X POST http://localhost:8000/stream \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <tu-api-key>" \
  -d '{"thread_id": "demo-1", "mensaje": "Explica en dos frases qué es un índice de base de datos."}'

# Historial del thread
curl http://localhost:8000/threads/demo-1/history -H "X-API-Key: <tu-api-key>"
```

Sin Docker (requiere Postgres corriendo y `.env` con `DATABASE_URL` local):

```bash
uv sync --no-dev && uv run uvicorn api.main:app --reload
```

## Desplegar en Coolify

1. Crea una aplicación con **Dockerfile** (o Compose) apuntando a la carpeta del proyecto.
2. Define las variables en la UI de Coolify (nunca en el yaml):
   - `DEEPSEEK_API_KEY`, `API_KEYS`, `DATABASE_URL` (obligatorias, fail-fast).
   - `LANGSMITH_API_KEY` (opcional), `CORS_ORIGINS`, `RATE_LIMIT`, `LOG_LEVEL`, ...
3. **Dominio**: Coolify inyecta la variable mágica `SERVICE_URL_<NOMBRE>_8000`
   (p. ej. `SERVICE_URL_SYNCKRE_8000` si el servicio se llama `synckre`), que se usa
   como `TRUSTED_HOSTS`. Si tu servicio tiene otro nombre, fija `TRUSTED_HOSTS` a mano.
4. **Proxy**: fija `FORWARDED_ALLOW_IPS` a la subred del proxy de Coolify (Traefik),
   p. ej. `172.17.0.0/16`. La app solo confía en `X-Forwarded-*` desde esas IPs.
5. **Postgres**: el servicio `postgres` del compose usa un volumen nombrado
   (`synckre_pgdata`) y **no** se expone públicamente; `DATABASE_URL` apunta a
   `postgresql://<user>:<pass>@postgres:5432/<db>` (host = nombre del servicio).

La app publica solo el puerto interno `8000`; sin puertos al host. El `Dockerfile`
es multi-stage sobre `python:3.12-slim`, corre como usuario `appuser` no-root y
nunca copia `.env` ni secrets al build (todo se inyecta en runtime).

## Endpoints

| Método | Ruta                          | Auth      | Descripción                                   |
|--------|-------------------------------|-----------|-----------------------------------------------|
| POST   | `/invoke`                     | X-API-Key | Ejecución síncrona `{thread_id, mensaje}`     |
| POST   | `/stream`                     | X-API-Key | Streaming SSE por thread                       |
| GET    | `/health`                     | —         | Healthcheck simple                             |
| GET    | `/threads/{thread_id}/history`| X-API-Key | Historial del thread desde el checkpointer     |
| POST   | `/copilotkit`                 | —         | Agente CopilotKit (protocolo AG-UI): `RunAgentInput` → eventos SSE |
| GET    | `/copilotkit/health`          | —         | Healthcheck del agente CopilotKit              |

## CopilotKit (conectar un frontend)

El paquete oficial `copilotkit` está integrado en la API: expone el grafo como
endpoint de agente en **AG-UI** (`POST /copilotkit`, `GET /copilotkit/health`),
usando `LangGraphAGUIAgent` de `copilotkit` + `add_langgraph_fastapi_endpoint`
de `ag_ui_langgraph`. Las conversaciones se persisten en el mismo checkpointer
de Postgres (threadId AG-UI → thread del grafo).

Probar el endpoint (DeepSeek responde de verdad):

```bash
curl -N -X POST http://localhost:8000/copilotkit \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{
    "threadId": "demo-1",
    "runId": "run-1",
    "state": {},
    "messages": [{"id": "m1", "role": "user", "content": "Hola"}],
    "tools": [], "context": [], "forwardedProps": {}
  }'
```

Frontend: usa un cliente que hable AG-UI (`@copilotkit/react-core` v2 o
`@ag-ui/client`) y apunta su runtime/agent endpoint a
`http://localhost:8000/copilotkit` (o la URL pública equivalente).

> ⚠️ Notas:
> - El frontend **clásico v1** de CopilotKit (`runtimeUrl` con el protocolo
>   REST de `add_fastapi_endpoint`) no es compatible con `copilotkit>=0.1.94`:
>   su integración FastAPI para LangGraph está rota internamente
>   (`LangGraphAGUIAgent` no implementa `execute`). Usa el frontend v2 / AG-UI.
> - El endpoint `/copilotkit` es **público** (la UI no envía `X-API-Key`),
>   igual que `/health`. Para desactivarlo: `COPILOTKIT_ENABLED=false`.
>   En producción, protégelo en el proxy (Coolify/Traefik) si no lo usas.
> - Si el frontend corre en otro origen, agrega ese origen a `CORS_ORIGINS`
>   (p. ej. `CORS_ORIGINS=http://localhost:3000`).

## Seguridad (resumen)

- Autenticación `X-API-Key` con `secrets.compare_digest` (anti timing attacks);
  múltiples keys separadas por coma para rotación sin downtime.
- Rate limit por **API key** (no por IP): detrás de proxy, la IP no es fiable.
- CORS solo desde whitelist de env; TrustedHost limitado; headers
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Strict-Transport-Security`.
- `ProxyHeadersMiddleware` de uvicorn con `FORWARDED_ALLOW_IPS` restringido.
- Body máximo `BODY_LIMIT_BYTES` (413) y longitud máxima en campos de texto libre.
- Logging JSON (structlog) que redacta keys/tokens/`DATABASE_URL` y solo registra
  longitud/hash de los mensajes de usuario.
- Errores internos: detalle completo solo en logs server-side; el cliente recibe
  un mensaje neutro (en `production`).

## Desarrollo

```bash
make lint     # ruff + mypy --strict
make test     # pytest tests/unit_tests
```
