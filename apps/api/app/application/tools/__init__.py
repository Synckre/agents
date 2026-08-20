"""
Paquete de Herramientas de Synckre Agent V2.
Importa todos los módulos de herramientas para que queden registradas en ToolRegistry.
"""

from app.application.tools.communication import send_email, request_information, transfer_to_agent
from app.application.tools.calendar_tools import check_availability, create_event, reschedule_event, cancel_event
from app.application.tools.support_tools import create_ticket, update_ticket, escalate_ticket
from app.application.tools.documents_tools import (
    read_public_knowledge,
    read_internal_knowledge,
    search_documents,
    generate_document,
    generate_contract,
    approve_contract,
)
from app.application.tools.crm_tools import create_lead, create_customer, update_customer, update_lead, add_lead_note
from app.application.tools.erp_tools import read_customer, read_invoice

__all__ = [
    "send_email",
    "request_information",
    "transfer_to_agent",
    "check_availability",
    "create_event",
    "reschedule_event",
    "cancel_event",
    "create_ticket",
    "update_ticket",
    "escalate_ticket",
    "read_public_knowledge",
    "read_internal_knowledge",
    "search_documents",
    "generate_document",
    "generate_contract",
    "approve_contract",
    "create_lead",
    "create_customer",
    "update_customer",
    "update_lead",
    "add_lead_note",
    "read_customer",
    "read_invoice",
]
