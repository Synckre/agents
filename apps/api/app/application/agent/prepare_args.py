"""Prepara kwargs de tools: sanitiza y completa datos de conversación."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.application.agent.policies import GuardrailsEngine
from app.application.services.memory_service import extraer_datos, memory_service
from app.infrastructure.db.manager import db_manager


async def prepare_tool_args(
    tool_name: str,
    args: Dict[str, Any],
    *,
    conversation_id: str,
    user_input: str = "",
) -> Dict[str, Any]:
    exec_args = GuardrailsEngine.sanitize_tool_input(tool_name, dict(args or {}))
    if tool_name in ("create_event", "create_lead", "update_lead"):
        exec_args.setdefault("conversation_id", conversation_id)
    if tool_name in ("create_lead", "update_lead"):
        user_email = extraer_datos(user_input).get("email", "")
        if user_email:
            if tool_name == "create_lead":
                exec_args["email"] = user_email
            else:
                exec_args["email_nuevo"] = user_email
    if tool_name == "update_lead" and not exec_args.get("lead_id"):
        erp_id = await db_manager.get_lead_erp_id_for_conversation(conversation_id)
        if erp_id:
            exec_args["lead_id"] = erp_id
        elif not exec_args.get("email_actual"):
            current_email = await memory_service.get_email_for_conversation(conversation_id)
            if current_email:
                exec_args["email_actual"] = current_email
    return exec_args
