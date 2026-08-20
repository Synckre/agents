"""
Herramientas de Soporte Técnico para Synckre Agent V2.
Crea tickets (Doctype Issue de ERPNext), actualiza su estado/prioridad y los
escala a un equipo humano (comentario + prioridad alta en el Issue).
"""

from typing import Any, Dict

from app.application.agent.tools_registry import tool_registry
from app.infrastructure.integrations.erp import erpnext_client


@tool_registry.register(
    name="create_ticket",
    description="Registra un nuevo ticket de incidencia técnica o soporte postventa en ERPNext (Issue).",
    required_capabilities=["support.manage"],
    risk_level=2,
    idempotency_strategy="task_id",
)
async def create_ticket(sintoma: str, sistema: str = "", cliente_email: str = "") -> Dict[str, Any]:
    if not (sintoma or "").strip():
        return {"status": "permanent_failure", "message": "Falta el síntoma de la incidencia. Pídelo; no lo inventes."}
    if cliente_email and "@" not in cliente_email:
        return {"status": "permanent_failure", "message": "El email del cliente no es válido. Pídelo; no lo inventes."}

    subject = f"{sistema.strip()}: {sintoma.strip()[:80]}" if sistema else sintoma.strip()[:100]
    res = await erpnext_client.create_issue(
        subject=subject,
        description=sintoma.strip(),
        email_id=cliente_email.strip() or "",
    )
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo registrar el ticket en ERPNext: {res.get('error')}"}
    ticket_id = res.get("issue_id") or ""
    return {
        "status": "success",
        "ticket_id": ticket_id,
        "message": f"Ticket {ticket_id} registrado en ERPNext para el sistema '{sistema or 'no especificado'}'.",
    }


@tool_registry.register(
    name="update_ticket",
    description="Actualiza el estado o prioridad de un ticket existente en ERPNext (Issue).",
    required_capabilities=["support.manage"],
    risk_level=2,
)
async def update_ticket(ticket_id: str, estado: str, notas: str = "") -> Dict[str, Any]:
    if not (ticket_id or "").strip():
        return {"status": "permanent_failure", "message": "Falta el ticket_id."}
    res = await erpnext_client.update_issue(ticket_id.strip(), status=(estado or "").strip())
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo actualizar el ticket: {res.get('error')}"}
    comment_ok = True
    if notas and notas.strip():
        c = await erpnext_client.add_issue_comment(ticket_id.strip(), notas.strip())
        comment_ok = c.get("ok", False)
    return {
        "status": "success",
        "message": f"Ticket {ticket_id} actualizado a estado '{estado}'.",
        "nota_registrada": comment_ok,
    }


@tool_registry.register(
    name="escalate_ticket",
    description=(
        "Escala el ticket o la conversación para intervención de un operador humano. "
        "Úsala cuando el usuario pida hablar con una persona, un humano, un operador o atención humana. "
        "'ticket_id' puede ir vacío si no existe un ticket previo."
    ),
    required_capabilities=["support.manage"],
    risk_level=2,
)
async def escalate_ticket(ticket_id: str = "", razon: str = "El usuario solicitó atención humana") -> Dict[str, Any]:
    razon = (razon or "").strip() or "El usuario solicitó atención humana"
    if ticket_id:
        await erpnext_client.update_issue(ticket_id, priority="High")
        await erpnext_client.add_issue_comment(ticket_id, f"Escalado a operador humano. Razón: {razon}")
        ref = ticket_id
    else:
        # Sin ticket previo: crear el Issue de escalación
        res = await erpnext_client.create_issue(
            subject=f"Escalación a operador humano — {razon[:60]}",
            description=f"Razón: {razon}",
        )
        ref = res.get("issue_id") or f"ESC-{ticket_id or 'pendiente'}"
        if not res.get("ok"):
            return {"status": "temporary_failure", "message": f"No se pudo crear la escalación en ERPNext: {res.get('error')}"}
    return {
        "status": "success",
        "requires_human": True,
        "ticket_id": ref,
        "message": f"Solicitud {ref} escalada a operador humano. Razón: {razon}",
    }
