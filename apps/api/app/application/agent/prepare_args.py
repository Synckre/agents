"""Prepara kwargs de tools: sanitiza y clava identidad al texto del usuario."""

from __future__ import annotations

from typing import Any, Dict

from app.application.agent.policies import GuardrailsEngine
from app.application.agent.verbatim import pin_tool_args, snapshot_for_turn
from app.application.services.memory_service import memory_service
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

    snap = await snapshot_for_turn(conversation_id, user_input)
    exec_args = pin_tool_args(exec_args, snap, user_input)

    if tool_name in {"create_lead", "create_event", "create_customer", "update_customer", "update_lead"}:
        if snap.email and tool_name != "update_lead":
            exec_args["email"] = snap.email
        if snap.name:
            exec_args["nombre"] = snap.name
        if snap.phone:
            exec_args.setdefault("telefono", snap.phone)
        if snap.company:
            exec_args.setdefault("empresa", snap.company)

    if tool_name == "update_lead" and not exec_args.get("lead_id"):
        erp_id = await db_manager.get_lead_erp_id_for_conversation(conversation_id)
        if erp_id:
            exec_args["lead_id"] = erp_id
        elif not exec_args.get("email_actual"):
            current_email = snap.email or await memory_service.get_email_for_conversation(conversation_id)
            if current_email:
                exec_args["email_actual"] = current_email
    return exec_args
