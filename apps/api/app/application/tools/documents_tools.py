"""
Herramientas Documentales y de Contratos para Synckre Agent V2.
Permite buscar documentos RAG (public/internal), generar borradores de contratos
(persistidos en synckre.contracts) y aprobar contratos (requiere aprobación humana
del runtime; aquí solo se actualiza el estado y se audita).
"""

import uuid
from datetime import datetime
from typing import Any, Dict

from app.application.agent.tools_registry import tool_registry
from app.domain import ContractModel
from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.rag.service import knowledge_service


async def _buscar(domain: str, query: str) -> Dict[str, Any]:
    """Búsqueda RAG real sobre el dominio indicado."""
    if not (query or "").strip():
        return {"status": "permanent_failure", "message": "Falta la consulta. Pídela; no la inventes."}
    chunks = await knowledge_service.search_knowledge(
        domain=domain,
        query=query,
        allowed_domains=[domain],
        top_k=settings.TOP_K,
    )
    return {
        "status": "success",
        "domain": domain,
        "query": query,
        "results": chunks,
        "message": f"Se encontraron {len(chunks)} fragmentos relevantes en el dominio '{domain}'.",
    }


@tool_registry.register(
    name="read_public_knowledge",
    description="Consulta la base de conocimiento pública (FAQ, alcances de proyectos entregados).",
    required_capabilities=["documents.read"],
    risk_level=1,
)
async def read_public_knowledge(query: str) -> Dict[str, Any]:
    return await _buscar("public", query)


@tool_registry.register(
    name="read_internal_knowledge",
    description="Consulta la base de conocimiento interna reservada para empleados (procedimientos, Operating Agreement).",
    required_capabilities=["documents.read"],
    risk_level=1,
)
async def read_internal_knowledge(query: str) -> Dict[str, Any]:
    return await _buscar("internal", query)


@tool_registry.register(
    name="search_documents",
    description="Busca en los documentos del dominio indicado ('public' por defecto).",
    required_capabilities=["documents.read"],
    risk_level=1,
)
async def search_documents(query: str, domain: str = "public") -> Dict[str, Any]:
    dominio = (domain or "public").strip().lower()
    if dominio not in ("public", "internal"):
        return {"status": "permanent_failure", "message": f"Dominio no soportado: '{dominio}'."}
    return await _buscar(dominio, query)


@tool_registry.register(
    name="generate_document",
    description="Genera un documento o reporte interno en formato borrador.",
    required_capabilities=["documents.write"],
    risk_level=2,
)
def generate_document(tipo: str, contenido_resumen: str) -> Dict[str, Any]:
    doc_id = f"DOC-{uuid.uuid4().hex[:8].upper()}"
    return {
        "status": "success",
        "document_id": doc_id,
        "message": f"Documento '{tipo}' generado correctamente ({doc_id}).",
    }


@tool_registry.register(
    name="generate_contract",
    description="Genera y PERSISTE un borrador de contrato (Mantenimiento, Servicios, SLA) a partir de una plantilla.",
    required_capabilities=["contracts.generate"],
    risk_level=2,
)
async def generate_contract(cliente_nombre: str, cliente_email: str, plantilla: str, terminos: str) -> Dict[str, Any]:
    if not (cliente_nombre or "").strip() or "@" not in (cliente_email or ""):
        return {"status": "permanent_failure", "message": "Faltan nombre y email válidos del cliente. Pídelos; no los inventes."}
    if not (plantilla or "").strip() or not (terminos or "").strip():
        return {"status": "permanent_failure", "message": "Faltan plantilla o términos del contrato. Pídelos; no los inventes."}

    contract_id = f"CTR-{uuid.uuid4().hex[:8].upper()}"
    content = (
        f"CONTRATO DE SERVICIOS Y MANTENIMIENTO ({plantilla.strip().upper()})\n"
        f"CLIENTE: {cliente_nombre.strip()} ({cliente_email.strip()})\n"
        f"TÉRMINOS:\n{terminos}\n\n"
        f"ESTADO: Borrador generado por Synckre Agent V2. Requiere Aprobación Humana."
    )
    now = datetime.utcnow()
    contract = ContractModel(
        id=contract_id,
        customer_id=cliente_email.strip(),
        title=f"Contrato {plantilla.strip()} — {cliente_nombre.strip()}",
        status="draft",
        template_name=plantilla.strip(),
        content=content,
        created_by="agent",
        created_at=now,
        updated_at=now,
    )
    await db_manager.create_contract(contract)
    return {
        "status": "success",
        "contract_id": contract_id,
        "content": content,
        "message": f"Borrador de contrato {contract_id} generado y guardado.",
    }


@tool_registry.register(
    name="approve_contract",
    description="Acción Sensible (Nivel 3): Aprueba legalmente un contrato para su firma y envío al cliente.",
    required_capabilities=["contracts.approve"],
    risk_level=3,
    requires_approval=True,
)
async def approve_contract(contract_id: str, aprobador_email: str) -> Dict[str, Any]:
    if not contract_id or "@" not in (aprobador_email or ""):
        return {"status": "permanent_failure", "message": "Faltan contract_id o email del aprobador."}
    updated = await db_manager.update_contract_status(contract_id, "approved", aprobador_email)
    if not updated:
        return {"status": "permanent_failure", "message": f"Contrato '{contract_id}' no encontrado en el sistema."}
    await db_manager.log_audit(
        agent_role="human_operator",
        action="approve_contract",
        user_id=aprobador_email,
        task_id=None,
        input_summary=f"Aprobación del contrato {contract_id}",
        output_summary=None,
        authorization_result="authorized",
    )
    return {
        "status": "success",
        "contract_id": contract_id,
        "approved_by": aprobador_email,
        "message": f"Contrato {contract_id} aprobado por {aprobador_email}.",
    }
