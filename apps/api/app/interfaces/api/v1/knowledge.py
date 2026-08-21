"""
Endpoints de Gestión RAG y Fuentes de Conocimiento.
Soporta ingesta por texto plano y subida directa de PDFs (pymupdf) con vectorización por chunks.
"""

import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.infrastructure.db.manager import db_manager
from app.infrastructure.rag.service import knowledge_service
from app.interfaces.limiter import limiter
from app.interfaces.security import require_authenticated_user

logger = logging.getLogger("knowledge_api")

router = APIRouter(
    prefix="/api/v1/knowledge",
    tags=["Knowledge / RAG"],
    dependencies=[Depends(require_authenticated_user)],
)

# Dominios permitidos para ingesta (whitelist: evita inyectar a 'internal' u otros)
ALLOWED_INGEST_DOMAINS = {"public", "internal", "faq", "customer", "services", "project", "department"}


def _validate_domain(domain: str) -> str:
    d = (domain or "public").strip().lower()
    if d not in ALLOWED_INGEST_DOMAINS:
        raise HTTPException(status_code=400, detail=f"Dominio no permitido: '{d}'.")
    return d


class IngestDocumentRequest(BaseModel):
    title: str
    domain: str = "public"
    content: str
    filename: str


def _extract_pdf_text(file_bytes: bytes) -> str:
    """Extrae el texto de un PDF usando pymupdf (fitz). Import perezoso para no romper el arranque si no está instalado."""
    try:
        import fitz  # pymupdf
    except ImportError:
        try:
            import pymupdf as fitz  # type: ignore[no-redef]
        except ImportError:
            logger.error("pymupdf no está instalado; añádelo con 'pip install pymupdf'.")
            return ""
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = [page.get_text("text") for page in doc]
        doc.close()
        return "\n\n".join(pages).strip()
    except Exception as exc:
        logger.error(f"Error extrayendo texto del PDF: {exc}")
        return ""


def _chunk_text(text: str, chunk_size: int = 1200, overlap: int = 200) -> List[str]:
    """Divide el texto en chunks de ~chunk_size caracteres con solapamiento entre bloques."""
    text = " ".join(text.split())
    if len(text) <= chunk_size:
        return [text] if text else []
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        # Recortar al último espacio para no partir palabras
        if end < len(text):
            cut = text.rfind(" ", start + int(chunk_size * 0.6), end)
            if cut > start:
                end = cut
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


async def _store_chunks(
    *,
    source_id: str,
    title: str,
    domain: str,
    filename: str,
    chunks: List[str],
    source_type: str,
) -> Dict[str, Any]:
    """Inserta la fuente en knowledge_sources y sus chunks vectorizados en document_chunks."""
    if not await db_manager._ensure_connected():
        return {"status": "error", "message": "Base de datos no disponible."}

    async with db_manager.pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO synckre.knowledge_sources
                    (id, title, domain, source_type, file_path, status, chunk_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING;
                """,
                (source_id, title, domain, source_type, None, "indexed", len(chunks)),
            )

            for idx, chunk in enumerate(chunks):
                embedding = await knowledge_service.get_embedding(chunk)
                embedding_str = f"[{','.join(map(str, embedding))}]"
                await conn.execute(
                    """
                    INSERT INTO synckre.document_chunks
                        (source_id, filename, chunk_index, content, embedding, domain)
                    VALUES (%s, %s, %s, %s, %s::vector, %s);
                    """,
                    (source_id, filename, idx + 1, chunk, embedding_str, domain),
                )
    return {"status": "success", "chunk_count": len(chunks), "source_id": source_id}


@router.get("", summary="Listar fuentes RAG")
async def list_knowledge_sources():
    if not await db_manager._ensure_connected():
        return []
    sql = "SELECT id, title, domain, source_type, status, chunk_count, created_at FROM synckre.knowledge_sources;"
    async with db_manager.pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql)
            rows = await cur.fetchall()
            return [
                {
                    "id": r[0],
                    "title": r[1],
                    "domain": r[2],
                    "source_type": r[3],
                    "status": r[4],
                    "chunk_count": r[5],
                    "created_at": r[6].isoformat() if r[6] else None,
                }
                for r in rows
            ]


@router.post("", summary="Ingerir un documento de texto para RAG")
@limiter.limit("10/minute")
async def ingest_document(request: Request, req: IngestDocumentRequest):
    result = await _store_chunks(
        source_id=f"SRC-{uuid.uuid4().hex[:8]}",
        title=req.title,
        domain=_validate_domain(req.domain),
        filename=req.filename,
        chunks=[req.content],
        source_type="text",
    )
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail="No se pudo vectorizar el documento.")
    return {
        "status": "success",
        "message": f"Documento '{req.title}' ingerido en dominio '{req.domain}'.",
        "chunk_count": result["chunk_count"],
    }


@router.post("/upload", summary="Subir y vectorizar un PDF para RAG")
@limiter.limit("10/minute")
async def upload_pdf(
    request: Request,
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
    domain: str = Form(default="public"),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos PDF.")
    max_bytes = 25 * 1024 * 1024
    if file.size is not None and file.size > max_bytes:
        raise HTTPException(status_code=400, detail="El PDF excede el límite de 25 MB.")

    file_bytes = await file.read(max_bytes + 1)
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=400, detail="El PDF excede el límite de 25 MB.")
    if not file_bytes:
        raise HTTPException(status_code=400, detail="El archivo PDF está vacío.")
    if not file_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="El archivo no es un PDF válido.")

    text = _extract_pdf_text(file_bytes)
    if not text:
        raise HTTPException(
            status_code=400,
            detail="No se pudo extraer texto del PDF (¿está escaneado o protegido?).",
        )

    chunks = _chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=400, detail="El PDF no contiene texto aprovechable.")

    filename = Path(file.filename).name
    safe_title = (title or "").strip() or Path(filename).stem
    result = await _store_chunks(
        source_id=f"SRC-{uuid.uuid4().hex[:8]}",
        title=safe_title,
        domain=_validate_domain(domain),
        filename=filename,
        chunks=chunks,
        source_type="pdf",
    )
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail="No se pudo vectorizar el PDF.")

    return {
        "status": "success",
        "message": f"PDF '{filename}' ingerido en dominio '{domain}' con {result['chunk_count']} chunks.",
        "chunk_count": result["chunk_count"],
        "source_id": result.get("source_id"),
    }
