"""
Herramientas de Comunicación para Synckre Agent V2.
Incluye send_email (Resend/SendGrid), request_information y transfer_to_agent
(traspaso de la conversación entre agentes públicos).
"""

import logging
from typing import Any, Dict
from app.application.agent.tools_registry import tool_registry
from app.application.agent.roles import PUBLIC_AGENT_ROLES
from app.infrastructure.integrations.email import enviar_correo

logger = logging.getLogger(__name__)

_NOMBRES_AGENTES = {
    "contact_form_agent": "formulario de contacto",
    "customer_support": "soporte técnico",
    "sales_assistant": "el área comercial",
}


@tool_registry.register(
    name="send_email",
    description="Envía un correo electrónico oficial utilizando Resend o SendGrid.",
    required_capabilities=["email.send"],
    risk_level=2,
    requires_approval=False,
    idempotency_strategy="task_id",
)
async def send_email(destinatario: str, asunto: str, cuerpo: str) -> Dict[str, Any]:
    res = await enviar_correo(destinatario, asunto, cuerpo)
    if "Envío fallido" in res or "no enviado" in res:
        return {"status": "permanent_failure", "message": res}
    return {"status": "success", "message": res}


@tool_registry.register(
    name="transfer_to_agent",
    description=(
        "Transfiere la conversación a otro agente público cuando el usuario necesita un equipo "
        "distinto: soporte técnico/incidencias -> 'customer_support'; ventas/cotización/propuesta "
        "-> 'sales_assistant'. Solo se puede transferir entre agentes públicos: "
        "contact_form_agent, customer_support, sales_assistant."
    ),
    required_capabilities=["agent.transfer"],
    risk_level=1,
)
async def transfer_to_agent(role: str) -> Dict[str, Any]:
    target = (role or "").strip().lower()
    if target not in PUBLIC_AGENT_ROLES:
        return {
            "status": "permanent_failure",
            "message": (
                f"No se puede transferir al agente '{role or ''}'. Solo se permite transferir "
                f"entre agentes públicos: {', '.join(sorted(PUBLIC_AGENT_ROLES))}."
            ),
        }
    equipo = _NOMBRES_AGENTES.get(target, target)
    return {
        "status": "success",
        "transfer_to": target,
        "message": f"Te transfiero con {equipo}. Un compañero continuará ayudándote.",
    }


@tool_registry.register(
    name="request_information",
    description="Solicita información adicional al usuario cuando faltan datos obligatorios.",
    required_capabilities=["support.manage"],
    risk_level=1,
    requires_approval=False,
)
def request_information(campo_requerido: str, motivo: str) -> Dict[str, Any]:
    return {
        "status": "success",
        "message": f"Se solicita al usuario el campo '{campo_requerido}': {motivo}",
    }
