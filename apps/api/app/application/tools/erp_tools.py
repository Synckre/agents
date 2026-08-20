"""
Herramientas de ERP / Facturación para Synckre Agent V2.
Permite consultar datos de clientes y facturas de ERPNext.
"""

from typing import Any, Dict

from app.application.agent.tools_registry import tool_registry
from app.infrastructure.integrations.erp import erpnext_client


@tool_registry.register(
    name="read_customer",
    description="Consulta la información de un cliente en ERPNext (por nombre o email). Solo lectura de contexto.",
    required_capabilities=["erp.read"],
    risk_level=1,
)
async def read_customer(customer_id_or_email: str) -> Dict[str, Any]:
    if not (customer_id_or_email or "").strip():
        return {"status": "permanent_failure", "message": "Falta el id o email del cliente. Pídelo; no lo inventes."}

    res = await erpnext_client.get_customer(customer_id_or_email.strip())
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo recuperar el cliente: {res.get('error')}"}

    cust = res.get("customer") or {}
    return {
        "status": "success",
        "customer": {
            "id": cust.get("name"),
            "nombre": cust.get("customer_name"),
            "email": cust.get("email_id"),
            "telefono": cust.get("mobile_no"),
            "grupo": cust.get("customer_group"),
        },
        "message": f"Datos de ERPNext para '{customer_id_or_email}' recuperados.",
    }


@tool_registry.register(
    name="read_invoice",
    description="Consulta una factura (Sales Invoice) real en ERPNext por su id.",
    required_capabilities=["erp.read"],
    risk_level=1,
)
async def read_invoice(invoice_id: str) -> Dict[str, Any]:
    if not (invoice_id or "").strip():
        return {"status": "permanent_failure", "message": "Falta el id de la factura. Pídelo; no lo inventes."}

    res = await erpnext_client.get_invoice(invoice_id.strip())
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo recuperar la factura: {res.get('error')}"}

    inv = res.get("invoice") or {}
    return {
        "status": "success",
        "invoice": {
            "id": inv.get("name"),
            "cliente": inv.get("customer_name") or inv.get("customer"),
            "fecha": inv.get("posting_date"),
            "total": inv.get("grand_total"),
            "moneda": inv.get("currency"),
            "status": inv.get("status"),
            "pendiente": inv.get("outstanding_amount"),
        },
        "message": f"Datos de la factura '{invoice_id}' recuperados de ERPNext.",
    }
