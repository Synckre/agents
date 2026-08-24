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
| Control Center | http://localhost:3000 |

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
docker compose up -d postgres ollama

cd apps/api
PYTHONPATH="$PWD" uvicorn app.interfaces.main:app --reload --port 8000
```

Tests:

```bash
cd apps/api
PYTHONPATH="$PWD" pytest -q
```
