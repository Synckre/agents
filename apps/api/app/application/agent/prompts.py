"""Construcción del system prompt del agente. Copy literal; no cambia el comportamiento."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from app.application.agent.roles import RoleModel
from app.application.agent.text import redactar_datos_internos


def format_historial(messages: List[Dict[str, Any]]) -> str:
    lineas = []
    for m in (messages or [])[-10:]:
        sender = m.get("sender")
        who = (
            "Usuario"
            if sender == "user"
            else "Operador"
            if sender == "human"
            else "Asistente"
        )
        contenido = (m.get("content") or "").strip()[:400]
        if contenido:
            lineas.append(f"{who}: {contenido}")
    return "\n".join(lineas)


def describe_tool(t: Dict[str, Any]) -> str:
    params = t.get("parameters") or []
    if not params:
        return f"- {t['name']}: {t['description']}"
    args = ", ".join(f"{p['name']}{'?' if not p['required'] else ''}" for p in params)
    return f"- {t['name']}({args}): {t['description']}"


def build_system_prompt(
    *,
    role: RoleModel,
    tools: List[Dict[str, Any]],
    context: Dict[str, Any],
    tool_result: Optional[Dict[str, Any]] = None,
    json_loop: bool = True,
) -> str:
    tools_desc = "\n".join([describe_tool(t) for t in tools])
    rag_text = "\n".join([f"[{c.get('filename')}] {c.get('content')}" for c in context.get("rag_context", [])])
    historial = format_historial(context.get("messages", []))
    memoria = context.get("memory") or ""
    resultado_tool = (
        redactar_datos_internos(
            json.dumps(tool_result, ensure_ascii=False)[:1500],
            reemplazo="[referencia interna]",
        )
        if tool_result is not None
        else ""
    )

    from app.application.agent.company_scope import company_scope_prompt
    from app.application.agent.language import language_lock

    lang = context.get("user_language") or "es"
    system_prompt = (
        f"{language_lock(lang)}"
        f"{company_scope_prompt()}"
        f"{role.system_policy}\n\n"
        f"HERRAMIENTAS AUTORIZADAS PARA TU ROL:\n{tools_desc if tools_desc else 'Ninguna herramienta externa.'}\n\n"
        f"CONOCIMIENTO RAG RECUPERADO:\n{rag_text if rag_text else 'Sin información RAG adicional.'}\n\n"
        f"DATOS CONOCIDOS DEL CONTACTO (ERPNext + MEMORIA DE CONVERSACIÓN):\n"
        f"{memoria if memoria else 'No hay datos previos del contacto (ERPNext/memoria); pídelos si los necesitas.'}\n\n"
        f"HISTORIAL DE LA CONVERSACIÓN:\n"
        f"{historial if historial else '(Primera interacción con este usuario).'}\n\n"
        f"INSTRUCCIONES DE MEMORIA (OBLIGATORIO):\n"
        f"- Usa los 'DATOS CONOCIDOS DEL CLIENTE' y el historial: si el usuario ya proporcionó "
        f"su nombre, correo, empresa o motivo, NO se los vuelvas a pedir: úsalos.\n"
        f"- Si ya agendaste una cita o enviaste un correo en mensajes anteriores, no lo repitas "
        f"ni ofrezcas hacerlo de nuevo salvo que el usuario lo pida.\n"
        f"- Mantén la continuidad: retoma el último tema de la conversación.\n\n"
    )
    if "transfer_to_agent" in [t["name"] for t in tools]:
        system_prompt += (
            f"TRASPASO ENTRE AGENTES:\n"
            f"- Si el usuario necesita un equipo distinto (soporte técnico/incidencia -> "
            f"'customer_support'; ventas/cotización/propuesta -> 'sales_assistant'), usa la tool "
            f"transfer_to_agent y avisa al usuario de la transferencia.\n"
            f"- Solo puedes transferir entre agentes públicos: contact_form_agent, "
            f"customer_support, sales_assistant (nunca a un agente interno).\n\n"
        )
    if "add_lead_note" in [t["name"] for t in tools]:
        system_prompt += (
            f"NOTAS EN EL CRM:\n"
            f"- Cuando el cliente indique qué necesita, su situación o detalles relevantes "
            f"(servicio de interés, contexto del proyecto, urgencia), guárdalo como nota del "
            f"lead con add_lead_note (usa el email del cliente). Las notas del CRM van SIEMPRE "
            f"en español (interno), aunque el chat con el cliente sea en inglés.\n\n"
        )
    if any(t["name"] in ("create_lead", "update_lead") for t in tools):
        system_prompt += (
            f"CONFIRMACIÓN DE EMAIL (OBLIGATORIO):\n"
            f"- ANTES de registrar un lead (create_lead) o de actualizar un email (update_lead), "
            f"MUESTRA el email al usuario y pide confirmación explícita, por ejemplo: "
            f"'¿Confirmas que tu correo es {{{{email}}}}? Responde sí o dime el correcto.'\n"
            f"- NO llames create_lead ni update_lead hasta que el usuario confirme "
            f"(sí / confirmo / correcto) o te indique la dirección correcta.\n"
            f"- Si el usuario corrige el email, usa EXACTAMENTE el que él escribió, "
            f"no el que tú recuerdes.\n\n"
        )
    if "create_event" in [t["name"] for t in tools]:
        system_prompt += (
            f"INTENCIÓN DE CITA (PRIORIDAD):\n"
            f"- Si el usuario pide AGENDAR una cita/reunión ('agendar', 'cita', 'reunión', 'horario', "
            f"'juntarnos', 'reunirnos'), tu objetivo es AGENDARLA: ofrece horarios con check_availability, "
            f"confirma el horario elegido y llama create_event.\n"
            f"- create_event YA registra/vincula el lead del cliente automáticamente: NO llames create_lead "
            f"por separado cuando la intención es una cita (solo retrasa y duplica).\n"
            f"- create_lead es SOLO para cuando el usuario comparte sus datos/solicitud SIN pedir una cita.\n\n"
        )
    if resultado_tool:
        system_prompt += (
            f"RESULTADO DE LA HERRAMIENTA QUE ACABAS DE EJECUTAR:\n{resultado_tool}\n\n"
            f"INSTRUCCIÓN (segunda llamada): Escribe el mensaje FINAL al usuario integrando "
            f"este resultado de forma natural y legible. Si contiene horarios, listas o datos "
            f"(por ejemplo horarios disponibles, confirmaciones, referencias), muéstralos al usuario "
            f"con viñetas '- '. NO lo ocultes ni digas que 'estás consultando' si ya tienes el dato. "
            f"En esta respuesta NO selecciones ninguna herramienta: tool_to_call siempre null.\n\n"
        )
    if json_loop:
        system_prompt += (
            f"INSTRUCCIONES DE SALIDA:\n"
            f"Responde estrictamente en formato JSON válido con las claves:\n"
            f'{{"answer": "Texto de tu respuesta al usuario", "tool_to_call": "nombre_tool_o_null", "tool_args": {{}}}}\n'
            f"Si decides llamar a una tool, 'tool_to_call' debe ser el nombre exacto de la tool autorizada "
            f"y 'tool_args' debe incluir EXACTAMENTE los parámetros indicados en su firma "
            f"(los marcados con '?' son opcionales). No inventes nombres de argumentos.\n"
            f"Si el usuario pide hablar con una persona, un humano, un operador o atención humana, "
            f"invoca la tool 'escalate_ticket' con una 'razon' descriptiva ('ticket_id' puede ir vacío).\n\n"
        )
    else:
        system_prompt += (
            "HERRAMIENTAS:\n"
            "Usa las function tools disponibles. No inventes nombres de argumentos. "
            "Si el usuario pide hablar con una persona, un humano, un operador o atención humana, "
            "invoca escalate_ticket con una razon descriptiva (ticket_id puede ir vacío).\n\n"
        )
    system_prompt += (
        f"FORMATO DE RESPUESTA (OBLIGATORIO, en el campo 'answer' si aplica):\n"
        f"- Escribe para un humano: texto fácil de leer, nunca un muro de texto.\n"
        f"- Usa párrafos cortos (2-3 frases) y EXACTAMENTE una línea en blanco entre párrafos "
        f"(nunca más de una). No pongas cada frase en una línea aparte.\n"
        f"- Las listas SIEMPRE con viñetas '- ' (o numeración '1. '), un ítem por línea y "
        f"SIN línea en blanco entre ítems.\n"
        f"- Usa **negritas** para los datos clave (nombres, fechas, horas, referencias, totales).\n"
        f"- NUNCA muestres al usuario la palabra 'Referencia', '[referencia interna]' ni ningún id "
        f"interno (LEAD-, TSK-, CONV-, EV-...): si un dato viene marcado como '[referencia interna]', "
        f"omítelo por completo.\n"
        f"- Usa ## solo cuando la respuesta tenga secciones claras (ej. resumen, pasos, contacto).\n"
        f"- Emojis: úsalos con moderación y coherentes con el contexto "
        f"(✅ confirmación, 📅 cita, ⏰ recordatorio, 📧 correo, ❌ problema, 👋 saludo). No los acumules.\n\n"
        f"IDIOMA:\n"
        f"- Entiendes español e inglés por igual.\n"
        f"- Salida de este turno: {'ENGLISH' if lang == 'en' else 'ESPAÑOL'}. "
        f"No mezcles idiomas en la respuesta (salvo nombres propios, emails y citas literales).\n"
    )
    return system_prompt
