"""API FastAPI: expone el grafo LangGraph como REST.

- POST /invoke: ejecución síncrona.
- POST /stream: streaming por Server-Sent Events.
- GET /health: healthcheck simple, sin autenticación.
- GET /threads/{thread_id}/history: historial desde el checkpointer.
- /copilotkit: endpoint de agente CopilotKit (protocolo AG-UI).
  POST /copilotkit -> RunAgentInput -> eventos SSE; GET /copilotkit/health.

El checkpointer de Postgres se inicializa en el lifespan (arranque), con pool
compartido; nunca por request.
"""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import structlog
from ag_ui_langgraph.endpoint import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Path,
    Request,
    status,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from langchain_core.messages import HumanMessage
from slowapi.errors import RateLimitExceeded

from agent.graph import build_graph, create_model
from api.checkpointer import (
    CheckpointerHandle,
    create_checkpointer,
    get_thread_messages,
)
from api.logging_conf import hash_text, setup_logging
from api.models import HistoryResponse, InvokeRequest, InvokeResponse, MessageOut
from api.security import (
    BodySizeLimitMiddleware,
    SecurityHeadersMiddleware,
    create_limiter,
    rate_limit_handler,
    require_api_key,
)
from api.settings import get_settings

settings = get_settings()
logger = structlog.get_logger(__name__)
limiter = create_limiter(settings)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Arranque: logging, checkpointer (setup una sola vez) y compilación del grafo."""
    setup_logging(settings)
    if settings.langsmith_api_key:
        os.environ.setdefault("LANGSMITH_API_KEY", settings.langsmith_api_key)

    handle = await create_checkpointer(settings)
    llm = create_model(timeout=settings.llm_timeout_seconds)
    app.state.checkpointer = handle
    app.state.graph = build_graph(llm=llm, checkpointer=handle.saver)
    if settings.copilotkit_enabled:
        # CopilotKit (protocolo AG-UI): expone el grafo como endpoint de agente.
        # POST /copilotkit        -> RunAgentInput (AG-UI) -> eventos SSE
        # GET  /copilotkit/health -> healthcheck del agente
        # El frontend oficial (@copilotkit/react-core v2 / @ag-ui/client)
        # apunta su runtimeUrl / agent endpoint a esta ruta.
        agent = LangGraphAGUIAgent(
            name="synckre",
            description=(
                "Agente multi-agente de Synckre: supervisor + workers "
                "(researcher, writer, coder)."
            ),
            graph=app.state.graph,
        )
        add_langgraph_fastapi_endpoint(app, agent, path="/copilotkit")
        logger.info("copilotkit_habilitado", path="/copilotkit")
    logger.info(
        "api_started",
        env=settings.app_env,
        checkpointer=settings.checkpointer_backend,
    )
    try:
        yield
    finally:
        await handle.close()
        logger.info("api_stopped")


app = FastAPI(
    title="Synckre Agent API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)

# Middlewares de seguridad (el orden importa: primero lo más externo).
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.body_limit_bytes)
if settings.cors_origins:
    # NUNCA allow_origins=["*"]: whitelist explícita desde env.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key"],
        allow_credentials=False,
        max_age=600,
    )
if settings.trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Error genérico: detalle completo solo en logs server-side, mensaje neutro al cliente."""
    logger.exception("error_no_controlado", path=request.url.path, exc_info=exc)
    detalle = str(exc) if not settings.is_production else "Error interno del servidor"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detalle": detalle}
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """422 neutro (solo tipos de error en logs, sin inputs ni valores)."""
    errores = [e.get("type") for e in exc.errors()]
    logger.warning("validacion_fallida", path=request.url.path, errores=errores)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detalle": "Datos inválidos"},
    )


def _sse(payload: dict[str, Any]) -> str:
    """Serializa un evento Server-Sent Events."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Healthcheck simple: sin autenticación y sin exponer información interna."""
    return {"status": "ok"}


@app.post("/invoke", response_model=InvokeResponse, tags=["agent"])
@limiter.limit(settings.rate_limit)
async def invoke(
    request: Request,
    body: InvokeRequest,
    _: None = Depends(require_api_key),
) -> InvokeResponse:
    """Ejecuta el grafo de forma síncrona y devuelve la respuesta final."""
    graph = request.app.state.graph
    config = {"configurable": {"thread_id": body.thread_id}}
    logger.info(
        "invoke_inicio",
        thread_id=body.thread_id,
        mensaje_len=len(body.mensaje),
        mensaje_hash=hash_text(body.mensaje),
    )
    try:
        result = await asyncio.wait_for(
            graph.ainvoke(
                {"messages": [HumanMessage(content=body.mensaje)]}, config=config
            ),
            timeout=settings.llm_timeout_seconds + 10.0,
        )
    except TimeoutError as exc:
        logger.warning("invoke_timeout", thread_id=body.thread_id)
        raise HTTPException(
            status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Tiempo de espera agotado",
        ) from exc
    messages = result.get("messages") or []
    # Última respuesta del worker (tipo "ai" con contenido real; ignora
    # tool-calls y ToolMessages de routing del supervisor).
    respuesta = next(
        (
            str(m.content)
            for m in reversed(messages)
            if getattr(m, "type", "") == "ai" and getattr(m, "content", "")
        ),
        "",
    )
    return InvokeResponse(thread_id=body.thread_id, respuesta=respuesta)


@app.post("/stream", tags=["agent"])
@limiter.limit(settings.rate_limit)
async def stream(
    request: Request,
    body: InvokeRequest,
    _: None = Depends(require_api_key),
) -> StreamingResponse:
    """Ejecuta el grafo en streaming (Server-Sent Events) por thread."""
    graph = request.app.state.graph
    config = {"configurable": {"thread_id": body.thread_id}}

    async def event_generator() -> AsyncGenerator[str, None]:
        yield _sse({"type": "inicio", "thread_id": body.thread_id})
        try:
            async with asyncio.timeout(settings.llm_timeout_seconds + 30.0):
                async for event in graph.astream_events(
                    {"messages": [HumanMessage(content=body.mensaje)]},
                    config=config,
                    version="v2",
                ):
                    if event.get("event") == "on_chat_model_stream":
                        chunk = event.get("data", {}).get("chunk")
                        content = getattr(chunk, "content", None)
                        if content:
                            yield _sse({"type": "token", "content": str(content)})
            yield _sse({"type": "fin"})
        except TimeoutError:
            yield _sse({"type": "error", "detalle": "Tiempo de espera agotado"})
        except Exception:
            logger.exception("stream_error", thread_id=body.thread_id)
            yield _sse({"type": "error", "detalle": "Error interno del servidor"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/threads/{thread_id}/history", response_model=HistoryResponse, tags=["agent"])
@limiter.limit(settings.rate_limit)
async def thread_history(
    request: Request,
    thread_id: str = Path(
        min_length=1,
        max_length=settings.max_thread_id_length,
        pattern=r"^[A-Za-z0-9._-]+$",
    ),
    _: None = Depends(require_api_key),
) -> HistoryResponse:
    """Recupera el historial de un thread desde el checkpointer."""
    handle: CheckpointerHandle = request.app.state.checkpointer
    raw_mensajes = await get_thread_messages(handle.saver, thread_id)
    logger.info("history_obtenido", thread_id=thread_id, mensajes=len(raw_mensajes))
    return HistoryResponse(
        thread_id=thread_id, mensajes=[MessageOut(**m) for m in raw_mensajes]
    )
