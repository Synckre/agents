"""
Módulo de Memoria y Contexto para Synckre Agent V2.
Consolida la Memoria de Conversación, Memoria de Cliente, Memoria de Tareas y Memoria a Largo Plazo (RAG).
"""

import logging
from typing import Any, Dict, List, Optional
from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.application.services.memory_service import memory_service
from app.domain import ConversationModel, CustomerModel, MessageModel, TaskModel
from app.infrastructure.rag.service import knowledge_service

logger = logging.getLogger("agent_memory")


class MemoryRetriever:
    @staticmethod
    async def get_context(
        conversation_id: str,
        role_name: str,
        allowed_knowledge_sources: List[str],
        user_query: str,
    ) -> Dict[str, Any]:
        """
        Recupera y construye el contexto enriquecido para la llamada al LLM:
        1. Conversation Memory (mensajes recientes)
        2. Memory persistente (perfil de cliente o lead si aplica)
        3. Task Memory (tareas activas en esta conversación)
        4. Long-Term Memory / RAG (chunks relevantes filtrados por autorización)
        """
        # 1. Mensajes recientes
        messages: List[MessageModel] = await db_manager.get_messages(conversation_id, limit=10)

        # 2. Información de la Conversación
        conversation: Optional[ConversationModel] = await db_manager.get_conversation(conversation_id)

        # 3. Tareas activas asociadas a la conversación (filtradas en SQL, no en Python)
        tasks: List[TaskModel] = await db_manager.list_tasks(conversation_id=conversation_id, limit=10)
        active_tasks = [t for t in tasks if t.status not in ("completed", "cancelled")]

        # 4. RAG / Conocimiento a largo plazo (solo si hay query)
        rag_chunks = []
        if user_query and user_query.strip():
            # Determinar el dominio primario para RAG
            primary_domain = "public"
            if "internal" in allowed_knowledge_sources:
                primary_domain = "internal"

            rag_chunks = await knowledge_service.search_knowledge(
                domain=primary_domain,
                query=user_query,
                allowed_domains=allowed_knowledge_sources,
                top_k=settings.TOP_K,
            )

        return {
            "conversation_id": conversation_id,
            "role": role_name,
            "messages": [m.dict() for m in messages],
            "active_tasks": [t.dict() for t in active_tasks],
            "rag_context": rag_chunks,
            "memory": await memory_service.memory_block(conversation_id, role_name),
        }
