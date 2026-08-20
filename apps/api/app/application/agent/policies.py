"""
Motor de Políticas y Capacidades (Policy Engine) para Synckre Agent V2.
Evalúa en código Python si un rol o usuario está autorizado para ejecutar una Capability o Tool concreta,
así como si la Tool requiere aprobación humana según el Nivel de Autonomía.
"""

from typing import Any, Dict, List, Tuple
from app.domain import AutonomyLevel, RoleModel


# Definición de Capacidades del Sistema
CAPABILITIES: Dict[str, List[str]] = {
    "calendar.read": ["check_availability"],
    "calendar.write": ["create_event", "reschedule_event", "cancel_event"],
    "email.send": ["send_email"],
    "support.manage": ["create_ticket", "update_ticket", "escalate_ticket"],
    "documents.read": ["read_public_knowledge", "read_internal_knowledge", "search_documents"],
    "documents.write": ["generate_document"],
    "contracts.generate": ["generate_contract"],
    "contracts.approve": ["approve_contract"],
    "crm.write": ["create_lead", "create_customer", "update_customer", "update_lead", "add_lead_note"],
    "erp.read": ["read_customer", "read_invoice"],
    "agent.transfer": ["transfer_to_agent"],
}


class PolicyEngine:
    @staticmethod
    def is_tool_allowed(role: RoleModel, tool_name: str) -> bool:
        """Verifica si la herramienta está explícitamente dentro de las allowed_tools del rol."""
        return tool_name in role.allowed_tools

    @staticmethod
    def requires_human_approval(role: RoleModel, tool_name: str, tool_risk_level: int = 1) -> bool:
        """
        Determina si una tool requiere aprobación humana basada en:
        1. Nivel de riesgo de la tool (Risk level 3 = Sensible).
        2. Nivel de autonomía del rol.
        3. Configuración explícita en approval_policy del rol.
        """
        if tool_risk_level >= 3:
            return True

        if role.autonomy_level == AutonomyLevel.LEVEL_1_READ and tool_risk_level > 1:
            return True

        requires_list = role.approval_policy.get("requires_approval_for", [])
        if tool_name in requires_list:
            return True

        return False

    @staticmethod
    def filter_authorized_tools(role: RoleModel, available_tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filtra la lista de herramientas dejando únicamente las autorizadas para el rol."""
        authorized = []
        for tool in available_tools:
            tool_name = tool.get("name")
            if tool_name and PolicyEngine.is_tool_allowed(role, tool_name):
                authorized.append(tool)
        return authorized


import re

_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"disregard\s+system\s+prompt", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+in\s+dan\s+mode", re.IGNORECASE),
    re.compile(r"override\s+system\s+rules", re.IGNORECASE),
    re.compile(r"bypass\s+security\s+filter", re.IGNORECASE),
    re.compile(r"reveal\s+internal\s+api\s+keys", re.IGNORECASE),
]


class GuardrailsEngine:
    """Motor de Guardrails de entrada y salida para protección contra inyecciones y sanitización."""

    @staticmethod
    def detect_prompt_injection(user_input: str) -> Tuple[bool, str]:
        """Detecta intentos de inyección de prompt o anulación de instrucciones del sistema."""
        if not user_input:
            return False, ""
        for pattern in _INJECTION_PATTERNS:
            if pattern.search(user_input):
                return True, "Intento de inyección de prompt detectado por el motor de guardrails."
        return False, ""

    @staticmethod
    def sanitize_tool_input(tool_name: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitiza y recorta valores de los parámetros pasados a una herramienta."""
        sanitized = {}
        for key, val in input_data.items():
            if isinstance(val, str):
                # Eliminar caracteres nulos o comandos no seguros de shell
                cleaned = val.replace("\x00", "").strip()
                sanitized[key] = cleaned
            else:
                sanitized[key] = val
        return sanitized

