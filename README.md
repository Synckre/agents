# AgentSynckre

Monorepo con dos aplicaciones y Clean Architecture en el backend:

| Carpeta | Qué es |
|---|---|
| **apps/api/** | FastAPI — Agent Runtime, tools, RAG y recordatorios (Clean Architecture: domain → application → infrastructure → interfaces) |
| **apps/web/** | Next.js Control Center Dashboard (shadcn + view transitions) |
| **documents/** | Documentos RAG por dominio |
| **docker/** | Scripts auxiliares de Docker |

Detalle de arquitectura y comandos en [ARCHITECTURE.md](./ARCHITECTURE.md), [AGENTS.md](./AGENTS.md) y guía de despliegue en Coolify en [COOLIFY.md](./COOLIFY.md).

---

## Cómo correrlo

Desde la **raíz del repo**:

```bash
cp .env.example .env
# Edita DEEPSEEK_API_KEY, PUBLIC_API_KEY e INTERNAL_API_KEY

docker compose up -d --build
```

Espera a que `synckre_api` esté healthy. Luego:

| Qué | URL |
|---|---|
| API + docs | http://localhost:8000/docs |
| UI de revisión | http://localhost:8000/review |
| Temporal UI (solo lectura) | http://localhost:8088 |

### Probar la API

```bash
# Salud (sin clave)
curl http://localhost:8000/api/v1/health

# Chat interno (queda en revisión)
curl -s http://localhost:8000/api/v1/internal/chat \
  -H "x-api-key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"necesito el reporte de inventario"}'
```

Abre http://localhost:8000/review, pega `INTERNAL_API_KEY` y aprueba / edita / rechaza.

Sin `x-api-key` → 401. Clave pública contra `/internal` → 403.

### Ingesta RAG

Pon PDFs en `AI/documentos/public` o `AI/documentos/internal`:

```bash
docker compose run --rm ingest --domain public
docker compose run --rm ingest --domain internal
```

---

## Desarrollo local (sin rebuild de la API)

```bash
docker compose up -d postgres temporal-db temporal temporal-init temporal-ui ollama

cd AI
source venv/bin/activate
export PYTHONPATH="$(pwd):$(pwd)/../Temporal"

# terminal 1
WORKER_DOMAIN=public python -m temporal_app.workers.public

# terminal 2
env -u PUBLIC_API_KEY WORKER_DOMAIN=internal python -m temporal_app.workers.internal

# terminal 3
uvicorn main:app --reload --port 8000
```

Tests:

```bash
cd AI && source venv/bin/activate
PYTHONPATH="$(pwd):$(pwd)/../Temporal" pytest -q
```
