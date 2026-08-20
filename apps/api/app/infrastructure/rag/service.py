"""
KnowledgeService para Synckre Agent V2.
Maneja la ingesta de documentos y la búsqueda RAG aislada por dominio
(public, internal, customer, project, department) mediante Ollama (qwen3-embedding:0.6b, 1024 dims) y PostgreSQL pgvector.
"""

import logging
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager

logger = logging.getLogger("knowledge_service")

_EMBED_CACHE_TTL = 3600.0  # 1 hora


class KnowledgeService:
    def __init__(self):
        self.ollama_url = settings.OLLAMA_BASE_URL.rstrip("/")
        self.model = settings.EMBEDDING_MODEL
        # Caché en memoria de embeddings por texto: {text: (timestamp, vector)}
        self._embed_cache: Dict[str, Tuple[float, List[float]]] = {}

    async def ping(self) -> bool:
        """Comprueba que Ollama responde (para health check)."""
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(f"{self.ollama_url}/api/tags")
                return res.status_code < 300
        except Exception:
            return False

    def _cached_embedding(self, text: str) -> Optional[List[float]]:
        entry = self._embed_cache.get(text)
        if not entry:
            return None
        ts, vector = entry
        if time.monotonic() - ts > _EMBED_CACHE_TTL:
            self._embed_cache.pop(text, None)
            return None
        return vector

    async def get_embedding(self, text: str) -> List[float]:
        """Obtiene el vector embedding (1024 dims) desde Ollama, con caché en memoria."""
        cached = self._cached_embedding(text)
        if cached is not None:
            return cached
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    f"{self.ollama_url}/api/embeddings",
                    json={"model": self.model, "prompt": text},
                )
                if res.status_code == 200:
                    data = res.json()
                    embedding = data.get("embedding", [])
                    if len(embedding) == settings.EMBEDDING_DIMENSION:
                        self._embed_cache[text] = (time.monotonic(), embedding)
                        return embedding
                    logger.warning(
                        f"Dimensión de embedding devuelta ({len(embedding)}) no coincide con {settings.EMBEDDING_DIMENSION}."
                    )
                    return embedding
        except Exception as exc:
            logger.warning(f"Ollama no disponible para embeddings: {exc}")

        # Vector de ceros de respaldo si Ollama no está corriendo localmente
        return [0.0] * settings.EMBEDDING_DIMENSION

    async def search_knowledge(
        self,
        domain: str,
        query: str,
        allowed_domains: List[str],
        top_k: int = 4,
    ) -> List[Dict[str, Any]]:
        """
        Realiza búsqueda RAG aislada por dominio.
        FILTRADO ESTRICTO DE SEGURIDAD: Verifica si el dominio solicitado está permitido para el Rol/Usuario.
        Si un cliente público pide dominio 'internal', la búsqueda se restringe automáticamente a 'public'.
        """
        safe_domain = domain if domain in allowed_domains else ("public" if "public" in allowed_domains else allowed_domains[0])

        query_vector = await self.get_embedding(query)
        chunks = await db_manager.search_similar_chunks(
            domain=safe_domain,
            query_embedding=query_vector,
            top_k=top_k,
        )
        return chunks


knowledge_service = KnowledgeService()
