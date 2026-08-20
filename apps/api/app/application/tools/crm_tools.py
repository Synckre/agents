"""
Herramientas CRM / Leads para Synckre Agent V2.

Registra leads (Lead) y clientes (Customer) en ERPNext, persiste en
Postgres y envía el correo de confirmación/verificación de registro.
"""

from typing import Any, Dict, Optional

from app.application.agent.tools_registry import tool_registry
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.email import enviar_correo_html
from app.infrastructure.integrations.email_templates import email_verificacion_registro
from app.infrastructure.integrations.erp import erpnext_client, guardar_lead


async def _enviar_verificacion(nombre: str, email: str, entidad: str, referencia: str) -> str:
    asunto, html, texto = email_verificacion_registro(nombre, email, entidad, referencia)
    try:
        return await enviar_correo_html(email, asunto, html, texto)
    except Exception as exc:
        return f"Envío fallido: {exc}"


async def _fusionar_leads(
    source_id: str,
    target_id: str,
    email_final: str,
    email_viejo: str,
    conversation_id: Optional[str],
) -> Dict[str, Any]:
    """Consolida dos leads duplicados del mismo contacto (por erratas en el email).

    CONSERVA el lead que se está corrigiendo (source, el de la conversación, con el
    nombre actual del usuario), absorbe las notas del duplicado (target), lo elimina
    para liberar el email y actualiza el email del lead conservado.
    """
    # 1) copiar las notas del lead duplicado al lead conservado
    tgt = await erpnext_client._request("GET", f"Lead/{target_id}")
    tgt_data = (tgt.get("data") or {}) if tgt.get("ok") else {}
    for n in tgt_data.get("notes") or []:
        if isinstance(n, dict) and n.get("note"):
            await erpnext_client.add_lead_note(source_id, f"[absorbido desde {target_id}] {n['note']}")

    # 2) eliminar el duplicado (libera el email para el lead conservado)
    del_res = await erpnext_client.delete_lead(target_id)
    if not del_res.get("ok"):
        return {
            "status": "temporary_failure",
            "message": f"No se pudo consolidar los leads (error al eliminar el duplicado): {del_res.get('error')}",
        }

    # 3) actualizar el email del lead conservado (ya no hay conflicto)
    up = await erpnext_client.update_lead(source_id, email_final)
    if not up.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo actualizar el email del lead: {up.get('error')}"}

    # 4) memoria: renombrar email y re-apuntar filas del duplicado al lead conservado
    if email_viejo and email_viejo != email_final:
        await db_manager.update_memory_email(email_viejo, email_final)
    await db_manager.update_memory_lead_erp_id(target_id, source_id)
    if conversation_id:
        await db_manager.update_conversation_metadata(conversation_id, {"customer_email": email_final})

    # 5) auditoría
    await db_manager.log_audit(
        agent_role="system",
        action="lead_merge",
        input_summary=f"Consolidado {target_id} en {source_id}",
        output_summary=f"email final {email_final}",
        authorization_result="authorized",
    )

    # 6) reenviar confirmación al email correcto (con el nombre del lead conservado)
    det = await erpnext_client.get_lead(email_final)
    nombre = (det.get("lead", {}).get("lead_name") or "").strip() if det.get("ok") else ""
    email_result = await _enviar_verificacion(nombre or "Cliente", email_final, "lead", source_id)
    email_ok = "enviado" in (email_result or "").lower()
    aviso = f"Te reenviamos el correo de confirmación a {email_final}."
    if not email_ok:
        aviso = f"⚠️ El correo de confirmación NO pudo enviarse a {email_final}: {email_result}."

    return {
        "status": "success",
        "email": email_final,
        "email_sent": email_ok,
        "merged": True,
        "message": (
            f"Tu solicitud quedó consolidada en tu lead con el correo {email_final} "
            f"(se eliminó el duplicado que tenía ese email). {aviso} "
            f"Si no te llega, dime la dirección correcta y la revisamos."
        ),
    }


@tool_registry.register(
    name="update_lead",
    description=(
        "Corrige/actualiza los datos de un lead en ERPNext (p.ej. el EMAIL cuando el cliente "
        "se equivocó al registrarse). Acepta el id del lead, o el email actual con el que se "
        "registró, y el email nuevo. Reasigna la memoria local y la conversación, y REENVÍA "
        "el correo de confirmación a la dirección corregida."
    ),
    required_capabilities=["crm.write"],
    risk_level=2,
)
async def update_lead(
    email_actual: str = "",
    email_nuevo: str = "",
    lead_id: str = "",
    conversation_id: Optional[str] = None,
) -> Dict[str, Any]:
    email_actual = (email_actual or "").strip()
    email_nuevo = (email_nuevo or "").strip()
    lead_id = (lead_id or "").strip()

    if "@" not in email_nuevo or "." not in email_nuevo:
        return {"status": "permanent_failure", "message": "El email nuevo no es válido. Pídelo; no lo inventes."}
    if email_actual and email_actual == email_nuevo and not lead_id:
        return {"status": "success", "email": email_nuevo, "message": f"Confirmado: el email {email_nuevo} ya es el correcto."}

    # Resolver el lead a corregir: POR ID cuando se conoce (memoria/tool), y solo como
    # respaldo, por email exacto (el de la conversación). Sin búsquedas difusas ni
    # preguntas al usuario.
    email_viejo = email_actual
    if not lead_id:
        emails_a_probar = []
        if email_actual and "@" in email_actual:
            emails_a_probar.append(email_actual)
        if conversation_id:
            conv = await db_manager.get_conversation(conversation_id)
            conv_email = str((conv.metadata or {}).get("customer_email") or "") if conv else ""
            if conv_email and "@" in conv_email and conv_email not in emails_a_probar:
                emails_a_probar.append(conv_email)

        for em in emails_a_probar:
            lead_id = await erpnext_client._find_lead_by_email(em)
            if lead_id:
                email_viejo = em
                break
            lead_id = await db_manager.get_lead_erp_id_by_email(em)
            if lead_id:
                email_viejo = em
                break

        if not lead_id:
            return {
                "status": "permanent_failure",
                "message": "No encontré el lead a corregir. Pide la referencia del lead o el email con el que se registró.",
            }

    res = await erpnext_client.update_lead(lead_id, email_nuevo)
    if not res.get("ok"):
        # 409 por email duplicado: el email nuevo ya pertenece a OTRO lead (mismo
        # contacto con erratas) -> unificar en lugar de fallar.
        target_id = await erpnext_client._find_lead_by_email(email_nuevo)
        if target_id and target_id != lead_id:
            return await _fusionar_leads(lead_id, target_id, email_nuevo, email_viejo, conversation_id)
        return {"status": "temporary_failure", "message": f"No se pudo actualizar el lead en ERPNext: {res.get('error')}"}

    # Sincronizar memoria local y metadata de la conversación
    if email_viejo and email_viejo != email_nuevo:
        await db_manager.update_memory_email(email_viejo, email_nuevo)
    if conversation_id:
        await db_manager.update_conversation_metadata(conversation_id, {"customer_email": email_nuevo})

    # Reenviar el correo de confirmación a la dirección corregida (el anterior no llegó)
    det = await erpnext_client.get_lead(email_nuevo)
    nombre = (det.get("lead", {}).get("lead_name") or "").strip() if det.get("ok") else ""
    email_result = await _enviar_verificacion(nombre or "Cliente", email_nuevo, "lead", lead_id)
    email_ok = "enviado" in (email_result or "").lower()

    if email_ok:
        aviso = f"Te reenviamos el correo de confirmación a {email_nuevo}."
    else:
        aviso = (
            f"⚠️ El correo de confirmación NO pudo enviarse a {email_nuevo}: {email_result}. "
            f"Verifica la dirección."
        )

    return {
        "status": "success",
        "email": email_nuevo,
        "email_sent": email_ok,
        "email_error": None if email_ok else email_result,
        "message": (
            f"Corregido: tu solicitud queda asociada a {email_nuevo}. {aviso} "
            f"Si no te llega, dime la dirección correcta y la actualizo."
        ),
    }


@tool_registry.register(
    name="add_lead_note",
    description=(
        "Guarda una NOTA en el Lead del cliente en ERPNext (lo que necesita, lo conversado, "
        "detalles de su proyecto). Acepta el email del lead y la nota a guardar."
    ),
    required_capabilities=["crm.write"],
    risk_level=1,
)
async def add_lead_note(email: str, nota: str) -> Dict[str, Any]:
    email = (email or "").strip()
    nota = (nota or "").strip()
    if "@" not in email:
        return {"status": "permanent_failure", "message": "Falta el email del lead. Pídelo; no lo inventes."}
    if not nota:
        return {"status": "permanent_failure", "message": "Falta el contenido de la nota."}

    lead_id = await erpnext_client._find_lead_by_email(email)
    if not lead_id:
        return {
            "status": "permanent_failure",
            "message": f"No encontré un lead con el email {email}. Regístralo primero con create_lead.",
        }
    res = await erpnext_client.add_lead_note(lead_id, nota)
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo guardar la nota en el lead: {res.get('error')}"}
    return {"status": "success", "message": f"Nota guardada en el lead de {email}."}


@tool_registry.register(
    name="create_lead",
    description="Registra un lead en ERPNext y la base de datos, y envía un correo de verificación de registro.",
    required_capabilities=["crm.write"],
    risk_level=2,
    idempotency_strategy="task_id",
)
async def create_lead(
    nombre: str,
    email: str,
    empresa: str = "",
    telefono: str = "",
    mensaje: str = "",
    conversation_id: Optional[str] = None,
) -> Dict[str, Any]:
    if not (nombre or "").strip() or "@" not in (email or ""):
        return {"status": "permanent_failure", "message": "Faltan nombre o email válido. Pídelos; no los inventes."}

    resultado = await guardar_lead(
        nombre=nombre,
        email=email,
        empresa=empresa,
        telefono=telefono,
        mensaje=mensaje,
        origen="web",
    )
    # Guardar el erp_id en la metadata de la conversación: es la clave para corregir
    # el lead POR ID aunque el email de la conversación cambie después.
    erp_id = resultado.get("erp_id") or ""
    if conversation_id and erp_id:
        await db_manager.update_conversation_metadata(conversation_id, {"lead_erp_id": erp_id})
    referencia = erp_id or f"LEAD-{email}"
    email_result = await _enviar_verificacion(nombre, email, "lead", referencia)
    email_ok = "enviado" in (email_result or "").lower()

    if email_ok:
        mensaje = (
            f"Tu solicitud quedó registrada. "
            f"Correo de confirmación enviado a {email}. "
            f"Si no te llega en unos minutos, avísame y lo revisamos."
        )
    else:
        mensaje = (
            f"Tu solicitud quedó registrada, PERO el correo de confirmación NO pudo enviarse a {email}. "
            f"Detalle: {email_result}. Por favor confirma que la dirección de correo es correcta."
        )

    return {
        "status": "success",
        "lead_data": {
            "nombre": nombre,
            "email": email,
            "empresa": empresa,
            "telefono": telefono,
            "mensaje": mensaje,
            "erp_id": resultado.get("erp_id"),
            "erp_destino": resultado.get("erp_destino"),
        },
        "email_sent": email_ok,
        "email_error": None if email_ok else email_result,
        "message": mensaje,
    }


@tool_registry.register(
    name="create_customer",
    description="Da de alta un cliente en ERPNext y envía un correo de verificación de registro.",
    required_capabilities=["crm.write"],
    risk_level=2,
)
async def create_customer(nombre: str, email: str, empresa: str = "", telefono: str = "") -> Dict[str, Any]:
    if not (nombre or "").strip() or "@" not in (email or ""):
        return {"status": "permanent_failure", "message": "Faltan nombre o email válido. Pídelos; no los inventes."}

    res = await erpnext_client.create_customer(
        customer_name=nombre,
        email_id=email,
        mobile_no=telefono,
    )
    if not res.get("ok"):
        return {"status": "temporary_failure", "message": f"No se pudo crear el cliente en ERPNext: {res.get('error')}"}

    customer_id = res.get("customer_id") or f"CUST-{email}"
    email_result = await _enviar_verificacion(nombre, email, "cliente", customer_id)

    return {
        "status": "success",
        "customer_id": customer_id,
        "message": f"Cliente '{nombre}' creado en el sistema. {email_result}",
    }


@tool_registry.register(
    name="update_customer",
    description="Actualiza la ficha de un cliente existente en ERPNext (campos permitidos: customer_name, email_id, mobile_no, customer_group, website, phone).",
    required_capabilities=["crm.write"],
    risk_level=2,
)
async def update_customer(customer_id: str, campo: str, valor: str) -> Dict[str, Any]:
    if not (customer_id or "").strip() or not (campo or "").strip():
        return {"status": "permanent_failure", "message": "Faltan customer_id o campo a actualizar."}
    res = await erpnext_client.update_customer(customer_id.strip(), campo.strip(), valor or "")
    if not res.get("ok"):
        return {"status": "permanent_failure" if "no permitido" in str(res.get("error")) else "temporary_failure",
                "message": f"No se pudo actualizar el cliente: {res.get('error')}"}
    return {
        "status": "success",
        "message": f"Cliente {customer_id} actualizado: {campo} = {valor}.",
    }
