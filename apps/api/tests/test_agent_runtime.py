"""
Tests unitarios e integración para AgentRuntime, Roles y Policies en Synckre Agent V2.
"""

import asyncio

import pytest
from app.application.agent.policies import PolicyEngine
from app.application.agent.roles import RoleSystem
from app.application.agent.runtime import agent_runtime
from app.application.agent.tools_registry import tool_registry
from app.domain import AutonomyLevel

# Importar tools
import app.application.tools  # noqa: F401


def test_role_retrieval():
    support_role = RoleSystem.get_role("customer_support")
    assert support_role.name == "customer_support"
    assert "create_ticket" in support_role.allowed_tools
    assert support_role.autonomy_level == AutonomyLevel.LEVEL_2_SAFE_ACTION


def test_policy_authorization():
    support_role = RoleSystem.get_role("customer_support")
    admin_role = RoleSystem.get_role("management_assistant")

    # customer_support NO puede aprobar contratos ni leer facturas
    assert PolicyEngine.is_tool_allowed(support_role, "create_ticket") is True
    assert PolicyEngine.is_tool_allowed(support_role, "read_invoice") is False

    # management_assistant SÍ puede aprobar contratos
    assert PolicyEngine.is_tool_allowed(admin_role, "approve_contract") is True


def test_tool_registry_execution():
    tool_def = tool_registry.get_tool("request_information")
    assert tool_def is not None
    assert tool_def.risk_level == 1

    res = tool_def.func(campo_requerido="email", motivo="Prueba test")
    assert res["status"] == "success"


def test_execute_tool_filters_unknown_args():
    """Los kwargs inventados (p.ej. 'message') se descartan; con los requeridos la tool se ejecuta."""
    res = asyncio.run(
        tool_registry.execute_tool(
            "request_information",
            campo_requerido="email",
            motivo="Prueba",
            mensaje="argumento no soportado",
        )
    )
    assert res["status"] == "success", res


def test_execute_tool_missing_required_params():
    """Si faltan parámetros requeridos, se devuelve feedback accionable en vez de TypeError."""
    res = asyncio.run(tool_registry.execute_tool("request_information", message="solo un mensaje"))
    assert res["status"] == "permanent_failure"
    assert "campo_requerido" in res["error"] and "motivo" in res["error"], res["error"]
    assert "message" in res["error"], res["error"]


def test_runtime_escalation_creates_human_task():
    """Pedir hablar con un humano debe escalar: crear task human_escalation y responder con referencia."""
    from unittest.mock import AsyncMock, patch

    # Sin base de datos: _ensure_connected -> False (métodos DB se convierten en no-op)
    with patch("app.infrastructure.db.manager.db_manager._ensure_connected", AsyncMock(return_value=False)):
        result = asyncio.run(
            agent_runtime.execute(
                conversation_id="CONV-TEST-ESC",
                user_input="Quiero hablar con un humano por favor",
                role_name="customer_support",
            )
        )
    assert result.task_created is not None, "Debe crearse una tarea de escalación"
    assert result.task_created["type"] == "human_escalation"
    assert result.task_created["status"] == "waiting_human"
    assert "operador" in result.response_text.lower()
    # Las referencias internas nunca se muestran al usuario
    assert "Referencia" not in result.response_text
    assert "ISS-" not in result.response_text and "TSK-" not in result.response_text


def test_human_approval_policy():
    support_role = RoleSystem.get_role("customer_support")
    contract_tool = tool_registry.get_tool("approve_contract")
    assert contract_tool is not None

    # approve_contract es de Riesgo Nivel 3 -> exige aprobación humana obligatoria
    needs_approval = PolicyEngine.requires_human_approval(support_role, "approve_contract", contract_tool.risk_level)
    assert needs_approval is True


def test_email_templates_build():
    """Las plantillas de correo generan asunto, HTML y texto sin errores."""
    from app.infrastructure.integrations.email_templates import (
        email_confirmacion_cita,
        email_recordatorio_cita,
        email_verificacion_registro,
    )

    a1, h1, t1 = email_confirmacion_cita("Juan", "2026-08-20T10:00:00+00:00", "Revisión", "EVT-1")
    assert "Juan" in h1 and t1
    assert "EVT-1" not in h1 and "Referencia" not in h1  # sin datos internos

    a2, h2, t2 = email_verificacion_registro("Ana", "ana@x.com", "lead", "LEAD-1")
    # Sin datos internos: ni referencia ni "tipo de registro"; solo acuse de recibo
    assert "recibido" in h2 and "Ana" in h2
    assert "LEAD-1" not in h2 and "lead" not in h2

    a3, h3, t3 = email_recordatorio_cita("Luis", "2026-08-20T10:00:00+00:00", "", "EVT-2", "minutos")
    assert t3 and "EVT-2" not in h3 and "Referencia" not in h3


def test_create_event_without_integrations_graceful():
    """Sin ERPNext ni Google Calendar configurados, create_event falla claro sin excepción."""
    from app.application.tools.calendar_tools import create_event

    res = asyncio.run(
        create_event(nombre="Juan", email="juan@example.com", motivo="Cita de prueba")
    )
    assert res["status"] in ("temporary_failure", "permanent_failure"), res
    assert res.get("message"), res


def test_erpnext_not_configured():
    """El cliente ERPNext sin credenciales responde ok=False sin red."""
    from app.infrastructure.integrations.erp import erpnext_client

    res = asyncio.run(
        erpnext_client.create_event(
            subject="Cita",
            starts_on="2026-08-20T10:00:00+00:00",
            ends_on="2026-08-20T10:30:00+00:00",
        )
    )
    assert res["ok"] is False
    assert "configurado" in res["error"]


def test_memory_extraccion_datos():
    """La extracción de memoria reconoce email, nombre, empresa y teléfono en texto libre."""
    from app.application.services.memory_service import extraer_datos

    d = extraer_datos(
        "Hola, soy Ebrahim Buceta, mi correo es ebrahim.buceta@gmail.com "
        "y trabajo en la empresa Tecnologia LLC. Mi teléfono es +34 600 123 456"
    )
    assert d.get("email") == "ebrahim.buceta@gmail.com"
    assert d.get("name") == "Ebrahim Buceta"
    assert "Tecnologia LLC" in d.get("company", "")
    assert d.get("phone")

    d2 = extraer_datos("Me llamo Ana y mi empresa es ACME")
    assert d2.get("name") == "Ana"
    assert d2.get("company") == "ACME"
    assert "email" not in d2


def test_config_disponibilidad_desde_erpnext():
    """El parsing de Appointment Booking Settings genera huecos por día y ventana."""
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.application.tools.calendar_tools import _config_disponibilidad, clear_availability_cache

    erpnext_cfg = {
        "enable_scheduling": 1,
        "appointment_duration": 30,
        "availability_of_slots": [
            {"day_of_week": "Monday", "from_time": "09:00:00", "to_time": "10:00:00"},
            {"day_of_week": "Wednesday", "from_time": "15:00:00", "to_time": "16:00:00"},
        ],
    }
    with patch(
        "app.application.tools.calendar_tools.erpnext_client.get_appointment_booking_settings",
        AsyncMock(return_value=erpnext_cfg),
    ):
        clear_availability_cache()  # evitar que la caché de otros tests contamine
        cfg = asyncio.run(_config_disponibilidad())

    assert cfg["source"] == "erpnext"
    assert cfg["duration"] == 30
    assert cfg["days"] == [0, 2]  # lunes y miércoles
    assert cfg["hours_by_day"][0] == [540, 570]   # 09:00, 09:30
    assert cfg["hours_by_day"][2] == [900, 930]   # 15:00, 15:30
    clear_availability_cache()  # no dejar la config mockeada cacheada


def test_redaccion_referencias_internas():
    """Las referencias internas (LEAD-, EV, TSK-, CONV-) se eliminan de respuestas y resultados."""
    from app.application.agent.runtime import redactar_datos_internos

    texto = "Registrado con referencia CRM-LEAD-2026-00006 y evento EV00004 en la conversación CONV-abc123."
    limpio = redactar_datos_internos(texto, reemplazo="")
    assert "CRM-LEAD" not in limpio and "EV00004" not in limpio and "CONV-abc123" not in limpio
    assert "Registrado con referencia" in limpio and "en la conversación" in limpio

    enmascarado = redactar_datos_internos(texto, reemplazo="[referencia interna]")
    assert "[referencia interna]" in enmascarado and "CRM-LEAD" not in enmascarado
