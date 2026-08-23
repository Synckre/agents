"""PromptBuilder: mismo contrato, sin I/O."""

from app.application.agent.prompts import build_system_prompt, describe_tool
from app.application.agent.roles import RoleSystem


def test_build_system_prompt_includes_role_and_json_contract():
    role = RoleSystem.get_role("customer_support")
    tools = [
        {
            "name": "send_email",
            "description": "Envía un correo",
            "parameters": [{"name": "destinatario", "required": True}],
        }
    ]
    prompt = build_system_prompt(role=role, tools=tools, context={"messages": [], "rag_context": []})
    assert role.system_policy[:40] in prompt
    assert "send_email" in prompt
    assert "tool_to_call" in prompt
    assert "INSTRUCCIONES DE SALIDA" in prompt


def test_describe_tool_marks_optional_params():
    line = describe_tool(
        {
            "name": "foo",
            "description": "bar",
            "parameters": [
                {"name": "a", "required": True},
                {"name": "b", "required": False},
            ],
        }
    )
    assert line.startswith("- foo(a, b?):")
