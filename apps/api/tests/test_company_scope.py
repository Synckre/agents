"""Ámbito Synckre, correos en idioma del cliente, resumen ERP en español."""

from app.application.agent.company_scope import (
    company_scope_prompt,
    is_off_topic,
    nota_interna_erp,
    resumen_interno_erp,
)
from app.application.agent.prompts import build_system_prompt
from app.application.agent.roles import RoleSystem
from app.infrastructure.integrations.email_templates import (
    email_confirmacion_cita,
    email_verificacion_registro,
)


def test_off_topic_jokes_and_recipes():
    assert is_off_topic("cuéntame un chiste")
    assert is_off_topic("tell me a joke please")
    assert is_off_topic("write me a poem about cats")
    assert not is_off_topic("I need help with our cloud infrastructure")
    assert not is_off_topic("Quiero agendar una cita para revisar el servidor")


def test_erp_summary_is_spanish_keeps_literal_query():
    nota = resumen_interno_erp(
        nombre="Ana",
        email="ana.lopez@cliente.com",
        consulta="Please call me about automation",
        idioma_cliente="en",
        origen="web",
    )
    assert "Resumen interno CRM (español)" in nota
    assert "inglés" in nota
    assert "Please call me about automation" in nota
    assert "ana.lopez@cliente.com" in nota


def test_erp_note_wraps_in_spanish():
    n = nota_interna_erp("Client wants AI onboarding next quarter")
    assert n.startswith("Nota interna CRM (español)")
    assert "Client wants AI onboarding next quarter" in n


def test_prompt_includes_company_scope():
    role = RoleSystem.get_role("contact_form_agent")
    prompt = build_system_prompt(role=role, tools=[], context={"messages": [], "rag_context": []})
    assert "COMPANY SCOPE" in prompt
    assert company_scope_prompt().split("\n")[0] in prompt


def test_email_templates_follow_client_language():
    a_es, h_es, t_es, tpl_es, _ = email_verificacion_registro("Ana", "ana@x.com", "lead", "L1", lang="es")
    assert "Hemos recibido" in h_es
    assert tpl_es == "email_verificacion_registro"
    a_en, h_en, t_en, tpl_en, _ = email_verificacion_registro("Ana", "ana@x.com", "lead", "L1", lang="en")
    assert "we have received" in h_en.lower()
    assert "Hemos recibido" not in h_en
    assert tpl_en == "email_verificacion_registro_en"

    _, h_cita, _, tpl_cita, _ = email_confirmacion_cita("Ana", "2026-08-20T10:00:00+00:00", "Kickoff", "EVT-1", lang="en")
    assert "appointment is confirmed" in h_cita.lower()
    assert tpl_cita == "email_confirmacion_cita_en"
