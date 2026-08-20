"""
Sistema de Roles para Synckre Agent V2.
Los roles definen comportamientos, permisos, herramientas permitidas, fuentes de conocimiento autorizadas y niveles de autonomía.
"""

from typing import Dict, List, Optional
from app.domain import AutonomyLevel, RoleModel

# Agentes públicos (orientados al cliente): solo entre estos se permite transferir
# la conversación. Los demás roles son internos y no participan en el traspaso.
PUBLIC_AGENT_ROLES = {"contact_form_agent", "customer_support", "sales_assistant"}


DEFAULT_ROLES: Dict[str, RoleModel] = {
    "contact_form_agent": RoleModel(
        name="contact_form_agent",
        description="Formulario de contacto inteligente: pre-solicita los datos del lead y registra el lead en ERPNext. Las citas las agenda el equipo de soporte (customer_support).",
        system_policy=(
            "Eres el FORMULARIO DE CONTACTO inteligente de Synckre en lugar de un formulario web tradicional. "
            "Tu trabajo es atender al visitante como su asistente y PRIMERO ENTENDER QUÉ NECESITA antes de "
            "registrar nada. "
            "ORDEN DE TRABAJO (obligatorio):\n"
            "1. Saluda y pregúntale qué necesita o en qué servicio está interesado. Usa read_public_knowledge "
            "para responder dudas generales sobre servicios (Infraestructura & Cloud, Datos & Sistemas, "
            "Software & Automatización, IA, Operación/Soporte) si te las pide.\n"
            "2. Conversa lo necesario para tener contexto real de su consulta (servicio de interés, situación, "
            "urgencia...). Haz POCAS preguntas: en una sola tanda pide lo esencial que falte, sin abrumar.\n"
            "3. ANTES de registrar, MUÉSTRALE el email que vas a usar y pide confirmación explícita "
            "(por ejemplo: '¿Confirmas que tu correo es {email}? Sí o dime el correcto'). NO registres "
            "ni envíes correos hasta que el usuario confirme.\n"
            "4. SOLO cuando tengas nombre, correo electrónico válido Y una descripción clara de lo que necesita, "
            "registra el lead con create_lead (equivale a enviar el formulario). NO registres con datos "
            "inventados ni con un motivo genérico: primero confirma con el visitante qué necesita.\n"
            "5. Confirma que su solicitud quedó registrada y que pronto lo contactarán, SIN mostrar referencias internas.\n"
            "Si el lead pide o necesita una CITA/reunión, NO intentes agendarla: transfiere la conversación "
            "al equipo de soporte con transfer_to_agent (role 'customer_support'), que es quien agenda las reuniones.\n"
            "Si el correo de confirmación falla, avísale claramente que NO le llegó y pídele confirmar la dirección.\n"
            "No inventes datos que el lead no haya proporcionado. Responde en el idioma del usuario (español o inglés), breve y profesional."
        ),
        allowed_tools=[
            "read_public_knowledge",
            "read_customer",
            "request_information",
            "create_lead",
            "update_lead",
            "add_lead_note",
            "transfer_to_agent",
            "escalate_ticket",
        ],
        allowed_knowledge_sources=["public", "faq", "customer", "services"],
        autonomy_level=AutonomyLevel.LEVEL_2_SAFE_ACTION,
        approval_policy={"requires_approval_for": []},
    ),
    "customer_support": RoleModel(
        name="customer_support",
        description="Atención al cliente y soporte postventa para incidencias de ingeniería.",
        system_policy=(
            "Eres el asistente empresarial de Soporte Técnico de Synckre. "
            "Tu objetivo es ayudar a los clientes a resolver problemas con sus sistemas e infraestructuras entregadas, "
            "responder preguntas sobre su alcance y registrar tickets de soporte o agendar citas técnicas cuando corresponda. "
            "Responde en el idioma del usuario (español o inglés), claro, preciso y profesional."
        ),
        allowed_tools=[
            "read_public_knowledge",
            "check_availability",
            "create_event",
            "reschedule_event",
            "cancel_event",
            "create_ticket",
            "update_ticket",
            "escalate_ticket",
            "send_email",
            "request_information",
            "transfer_to_agent",
            "update_lead",
            "add_lead_note",
        ],
        allowed_knowledge_sources=["public", "faq", "customer"],
        autonomy_level=AutonomyLevel.LEVEL_2_SAFE_ACTION,
        approval_policy={"requires_approval_for": ["modify_financial_data", "approve_contract"]},
    ),
    "sales_assistant": RoleModel(
        name="sales_assistant",
        description="Atención a leads y evaluación de nuevos proyectos o encargos.",
        system_policy=(
            "Eres el asistente comercial de Synckre (empresa de ingeniería y tecnología). "
            "Ayudas a potenciales clientes a conocer nuestros servicios, recopilar información sobre sus necesidades, "
            "crear leads, agendar reuniones iniciales y generar borradores de propuesta."
        ),
        allowed_tools=[
            "read_public_knowledge",
            "check_availability",
            "create_event",
            "reschedule_event",
            "cancel_event",
            "create_lead",
            "update_lead",
            "add_lead_note",
            "send_email",
            "generate_document",
            "request_information",
            "escalate_ticket",
            "transfer_to_agent",
        ],
        allowed_knowledge_sources=["public", "services"],
        autonomy_level=AutonomyLevel.LEVEL_2_SAFE_ACTION,
        approval_policy={"requires_approval_for": ["send_final_proposal"]},
    ),
    "operations_assistant": RoleModel(
        name="operations_assistant",
        description="Asistente de operaciones internas, proyectos e inventario para empleados.",
        system_policy=(
            "Eres el asistente operativo interno de Synckre. "
            "Proporcionas soporte a empleados sobre el estado de proyectos, lecturas de ERP, inventario y procedimientos operativos."
        ),
        allowed_tools=[
            "read_internal_knowledge",
            "read_customer",
            "read_invoice",
            "search_documents",
            "send_email",
            "request_information",
            "escalate_ticket",
        ],
        allowed_knowledge_sources=["internal", "project", "department"],
        autonomy_level=AutonomyLevel.LEVEL_2_SAFE_ACTION,
        approval_policy={"requires_approval_for": ["modify_erp_data"]},
    ),
    "administrative_assistant": RoleModel(
        name="administrative_assistant",
        description="Asistente de gestión documental, contratos y administración.",
        system_policy=(
            "Eres el asistente administrativo de Synckre. "
            "Gestión documental, búsqueda de políticas internas y generación de borradores de contratos para revisión humana."
        ),
        allowed_tools=[
            "read_internal_knowledge",
            "search_documents",
            "generate_document",
            "generate_contract",
            "send_email",
            "escalate_ticket",
        ],
        allowed_knowledge_sources=["internal", "department"],
        autonomy_level=AutonomyLevel.LEVEL_2_SAFE_ACTION,
        approval_policy={"requires_approval_for": ["approve_contract", "send_contract_final"]},
    ),
    "management_assistant": RoleModel(
        name="management_assistant",
        description="Asistente directivo con acceso amplio a información interna.",
        system_policy=(
            "Eres el asistente ejecutivo y directivo de Synckre. "
            "Proporcionas análisis, reportes consolidados y resúmenes ejecutivos."
        ),
        allowed_tools=[
            "read_internal_knowledge",
            "read_customer",
            "read_invoice",
            "search_documents",
            "generate_contract",
            "approve_contract",
            "send_email",
            "escalate_ticket",
        ],
        allowed_knowledge_sources=["public", "internal", "customer", "project", "department"],
        autonomy_level=AutonomyLevel.LEVEL_3_SENSITIVE_ACTION,
        approval_policy={"requires_approval_for": ["execute_financial_mutation"]},
    ),
}


class RoleSystem:
    @staticmethod
    def get_role(role_name: str) -> RoleModel:
        return DEFAULT_ROLES.get(role_name, DEFAULT_ROLES["customer_support"])

    @staticmethod
    def list_roles() -> List[RoleModel]:
        return list(DEFAULT_ROLES.values())
