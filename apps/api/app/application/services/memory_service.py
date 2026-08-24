"""
MemoryService — memoria de conversación por rol; ERPNext es la fuente de verdad de datos maestros.

Los datos maestros del contacto (nombre, empresa, teléfono) se leen SIEMPRE de ERPNext
(Customer o Lead por email); la tabla `synckre.memory` guarda SOLO notas de conversación
por rol (summary, preferencias, última interacción), con el email como clave.
Así no hay dos bases con los mismos datos: una sola fuente (ERPNext) + notas del agente.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from app.application.agent.verbatim import extraer_datos
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.erp import erpnext_client

logger = logging.getLogger("memory_service")


class MemoryService:
    async def get_email_for_conversation(self, conversation_id: str) -> Optional[str]:
        """Email del cliente asociado a la conversación (metadata) o del último mensaje."""
        conv = await db_manager.get_conversation(conversation_id)
        if conv:
            meta = conv.metadata or {}
            email = meta.get("customer_email")
            if email:
                return str(email)
        mensajes = await db_manager.get_messages(conversation_id, limit=20)
        for m in reversed(mensajes):
            if m.sender == "user":
                datos = extraer_datos(m.content)
                if datos.get("email"):
                    return datos["email"]
        return None

    async def ingest_message(self, conversation_id: str, role_name: str, texto: str) -> Dict[str, Any]:
        """Detecta la identidad (email) en el mensaje del usuario y la persiste.

        Solo la identidad se guarda localmente (como clave): los datos maestros
        (nombre, empresa, teléfono) vienen de ERPNext, fuente de verdad. La extracción
        heurística de nombre/empresa/teléfono NO se persiste, para no crear desfase.
        """
        datos = extraer_datos(texto)
        email = datos.get("email")
        if not email:
            return {}
        # Guardar el email detectado en la metadata de la conversación (identidad, compartida)
        await db_manager.update_conversation_metadata(
            conversation_id, {"customer_email": email}
        )
        # Fila de notas por rol: mantiene last_interaction; sin campos maestros
        await db_manager.upsert_memory(
            email=email,
            role_name=role_name,
            entity_type="customer",
        )
        return datos

    async def record_from_tool(
        self,
        *,
        conversation_id: str,
        role_name: str,
        tool_name: str,
        tool_args: Dict[str, Any],
    ) -> None:
        """Registra una nota de conversación (última acción / motivo) por rol.

        No persiste campos maestros: los datos del contacto se leen de ERPNext.
        """
        email = (
            (tool_args or {}).get("email")
            or (tool_args or {}).get("email_nuevo")
            or ""
        )
        if not email or "@" not in email:
            return
        conv = await db_manager.get_conversation(conversation_id)
        meta_email = str((conv.metadata or {}).get("customer_email") or "") if conv else ""
        from app.application.agent.verbatim import prefer_verbatim_email

        if meta_email:
            email = prefer_verbatim_email(email, meta_email)
        motivo = (tool_args or {}).get("mensaje") or (tool_args or {}).get("motivo") or ""
        summary = f"Última acción: {tool_name}"
        if motivo:
            summary += f" | Motivo: {str(motivo)[:200]}"
        await db_manager.upsert_memory(
            email=email,
            role_name=role_name,
            entity_type="customer",
            summary=summary,
        )
        await db_manager.update_conversation_metadata(
            conversation_id, {"customer_email": email}
        )

    async def perfil(self, conversation_id: str, role_name: str) -> Optional[Dict[str, Any]]:
        """Perfil del contacto para el LLM: datos maestros de ERPNext + notas locales.

        - master: nombre/empresa/teléfono desde ERPNext (Customer primero, luego Lead),
          que es la fuente de verdad. Si ERPNext no responde, va vacío (no se usan
          los campos maestros guardados localmente para evitar desfase).
        - notas: summary/preferencias/última interacción de la memoria local (por rol).
        """
        email = await self.get_email_for_conversation(conversation_id)
        if not email:
            return None

        maestro = {"name": "", "email": email, "company": "", "phone": "", "tipo": ""}
        if erpnext_client.is_configured():
            # Consultas en PARALELO (Customer + Lead) para no duplicar la latencia
            res_cust, res_lead = await asyncio.gather(
                erpnext_client.get_customer(email),
                erpnext_client.get_lead(email),
            )
            if res_cust.get("ok") and res_cust.get("customer"):
                c = res_cust["customer"]
                maestro = {
                    "name": c.get("customer_name") or "",
                    "email": c.get("email_id") or email,
                    "company": "",
                    "phone": c.get("mobile_no") or "",
                    "tipo": "cliente",
                }
            elif res_lead.get("ok") and res_lead.get("lead"):
                l = res_lead["lead"]
                maestro = {
                    "name": l.get("lead_name") or "",
                    "email": l.get("email_id") or email,
                    "company": l.get("company_name") or "",
                    "phone": l.get("mobile_no") or "",
                    "tipo": "lead",
                }

        notas = await db_manager.get_memory(email, role_name) or {}
        return {
            "master": maestro,
            "email": email,
            "notas": {
                "summary": notas.get("summary"),
                "preferences": notas.get("preferences") or {},
                "last_interaction": notas.get("last_interaction"),
            },
        }

    async def memory_block(self, conversation_id: str, role_name: str) -> str:
        """Bloque formateado (datos maestros de ERPNext + notas locales) para el prompt del LLM."""
        perfil = await self.perfil(conversation_id, role_name)
        if not perfil:
            return ""
        lineas = []
        m = perfil.get("master") or {}
        if m.get("name"):
            lineas.append(f"- Nombre: {m['name']}")
        if m.get("email"):
            lineas.append(f"- Correo: {m['email']}")
        if m.get("company"):
            lineas.append(f"- Empresa: {m['company']}")
        if m.get("phone"):
            lineas.append(f"- Teléfono: {m['phone']}")
        n = perfil.get("notas") or {}
        if n.get("summary"):
            lineas.append(f"- Nota: {n['summary']}")
        if n.get("preferences"):
            pref = n["preferences"]
            if pref:
                lineas.append(f"- Preferencias: {pref}")
        if not lineas:
            return ""
        return "\n".join(lineas)

    async def obtener_memoria_episodica(self, email: str, role_name: str) -> Optional[str]:
        """Obtiene la memoria episódica a largo plazo para un email del cliente."""
        if not email:
            return None
        try:
            row = await db_manager.get_memory(email, role_name)
            if not row:
                return None
            partes = []
            if row.get("summary"):
                partes.append(f"Resumen histórico: {row['summary']}")
            if row.get("preferences"):
                partes.append(f"Preferencias: {row['preferences']}")
            return " | ".join(partes) if partes else None
        except Exception as exc:
            logger.warning(f"Error al recuperar memoria episódica: {exc}")
            return None


memory_service = MemoryService()
