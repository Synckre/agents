"""
Cliente ERPNext (Frappe REST API) para Synckre Agent V2.

Controla la agenda de la compañía (Doctype Event), clientes (Customer) y leads (Lead).
Si ERPNext no está configurado (ERPNEXT_URL / API_KEY / API_SECRET), los métodos
devuelven errores claros y la app sigue funcionando con su almacenamiento local.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager

logger = logging.getLogger(__name__)

_TIMEOUT = 20.0
# Timeout corto para consultas de CONTEXTO (perfil del contacto): si ERPNext tarda,
# mejor continuar sin el perfil que bloquear cada mensaje.
_CONTEXT_TIMEOUT = 6.0
# Usuario de ERPNext que firma las notas de los leads (tabla hija 'notes').
# El nombre de usuario en ERPNext es el email: se creó 'synckreagent@synckre.local'
# con full_name "SynckreAgent" (no se puede usar un nombre sin @ en ERPNext).
_LEAD_NOTES_BY = "synckreagent@synckre.local"


def _frappe_dt(iso: str) -> str:
    """Convierte un ISO 8601 (o datetime) al formato Datetime de Frappe/MySQL."""
    if not iso:
        return iso
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(iso)


class ERPNextClient:
    def __init__(self) -> None:
        self.base = (settings.ERPNEXT_URL or "").rstrip("/")
        self.api_key = (settings.ERPNEXT_API_KEY or "").strip()
        self.api_secret = (settings.ERPNEXT_API_SECRET or "").strip()
        self._client: Optional[httpx.AsyncClient] = None

    def is_configured(self) -> bool:
        return bool(self.base and self.api_key and self.api_secret)

    def _http(self) -> httpx.AsyncClient:
        """Cliente HTTP compartido (se reutiliza entre llamadas y se cierra en aclose())."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=_TIMEOUT)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"token {self.api_key}:{self.api_secret}",
            "Content-Type": "application/json",
        }

    def _error(self, op: str) -> str:
        return (
            "ERPNext no está configurado (faltan ERPNEXT_URL, ERPNEXT_API_KEY o "
            "ERPNEXT_API_SECRET). No confirmes la operación al cliente."
        ) if not self.is_configured() else f"ERPNext no disponible para '{op}'."

    @staticmethod
    def _filters(filtros: list) -> str:
        """Serializa filtros Frappe a JSON string escapado (evita inyección por f-string)."""
        return json.dumps(filtros, ensure_ascii=False)

    async def _request(self, method: str, path: str, json: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Ejecuta una petición autenticada; devuelve {ok, data|error}."""
        if not self.is_configured():
            return {"ok": False, "error": self._error(path)}
        try:
            resp = await self._http().request(
                method,
                f"{self.base}/api/resource/{path}",
                headers=self._headers(),
                json=json,
            )
        except Exception as exc:
            logger.error("ERPNext request %s falló: %s", path, exc)
            return {"ok": False, "error": f"ERPNext no responde ({exc})."}
        if resp.status_code >= 300:
            logger.error("ERPNext %s %s: %s", method, path, resp.text[:300])
            return {"ok": False, "error": f"ERPNext respondió {resp.status_code}."}
        return {"ok": True, "data": (resp.json() or {}).get("data", {})}

    # ---------------------------------------------------------------
    # Agenda (Doctype Event)
    # ---------------------------------------------------------------
    async def create_event(
        self,
        *,
        subject: str,
        starts_on: str,
        ends_on: str,
        description: str = "",
        client_name: str = "",
        client_email: str = "",
    ) -> Dict[str, Any]:
        """Crea un Evento en la agenda de ERPNext.

        Solo vincula el participante (Customer) si ese cliente ya existe en ERPNext;
        si no, la información del cliente queda en la descripción para no fallar la creación.
        """
        payload: Dict[str, Any] = {
            "subject": subject,
            "starts_on": _frappe_dt(starts_on),
            "ends_on": _frappe_dt(ends_on),
            "event_type": "Private",
            "description": f"{description}\nCliente: {client_name} ({client_email})".strip(),
        }
        # Sincronizar el evento con Google Calendar si ERPNext tiene uno configurado
        calendar_name = await self._google_calendar_name()
        if calendar_name:
            payload["sync_with_google_calendar"] = 1
            payload["google_calendar"] = calendar_name
        if client_name and await self._customer_exists(client_name):
            payload["event_participants"] = [
                {
                    "participant": "Customer",
                    "reference_doctype": "Customer",
                    "reference_docname": client_name,
                }
            ]
        res = await self._request("POST", "Event", json=payload)
        if not res["ok"]:
            return {"ok": False, "error": res["error"], "event_id": ""}
        event = res.get("data") or {}
        return {"ok": True, "event_id": str(event.get("name") or ""), "data": event}

    async def _customer_exists(self, name: str) -> bool:
        """Comprueba si un Customer con ese nombre ya existe en ERPNext."""
        if not name or not self.is_configured():
            return False
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Customer/{name}",
                headers=self._headers(),
            )
            return resp.status_code < 300
        except Exception as exc:
            logger.warning("No se pudo comprobar el Customer '%s': %s", name, exc)
            return False

    async def get_customer(self, customer_id_or_email: str) -> Dict[str, Any]:
        """Busca un Customer en ERPNext por nombre o por email."""
        if not self.is_configured():
            return {"ok": False, "error": self._error("Customer"), "customer": {}}
        try:
            client = self._http()
            # 1) Por nombre (name del documento)
            resp = await client.get(
                f"{self.base}/api/resource/Customer/{customer_id_or_email}",
                headers=self._headers(),
                timeout=_CONTEXT_TIMEOUT,
            )
            if resp.status_code < 300:
                return {"ok": True, "customer": resp.json().get("data", {}), "error": ""}
            # 2) Por email (filtro escapado con json.dumps)
            resp2 = await client.get(
                f"{self.base}/api/resource/Customer",
                params={
                    "filters": self._filters([["email_id", "=", customer_id_or_email]]),
                    "fields": '["name","customer_name","email_id","mobile_no","customer_group"]',
                    "limit_page_length": 1,
                },
                headers=self._headers(),
                timeout=_CONTEXT_TIMEOUT,
            )
            if resp2.status_code < 300:
                rows = (resp2.json() or {}).get("data") or []
                if rows:
                    return {"ok": True, "customer": rows[0], "error": ""}
            return {"ok": False, "error": "Cliente no encontrado en ERPNext.", "customer": {}}
        except Exception as exc:
            logger.error("ERPNext get_customer falló: %s", exc)
            return {"ok": False, "error": f"ERPNext no responde ({exc}).", "customer": {}}

    async def get_appointment_booking_settings(self) -> Dict[str, Any]:
        """Lee la configuración nativa de ERPNext 'Appointment Booking Settings'
        (enable_scheduling, appointment_duration, advance_booking_days, availability_of_slots).

        Es una lectura de contexto: con timeout corto, si ERPNext tarda se usa el
        fallback de .env en lugar de bloquear al usuario.
        """
        if not self.is_configured():
            return {}
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Appointment%20Booking%20Settings/Appointment%20Booking%20Settings",
                headers=self._headers(),
                timeout=_CONTEXT_TIMEOUT,
            )
            if resp.status_code < 300:
                return (resp.json() or {}).get("data") or {}
        except Exception as exc:
            logger.warning("No se pudo leer Appointment Booking Settings: %s", exc)
        return {}

    async def get_business_availability(self) -> Dict[str, Any]:
        """Lee la configuración de disponibilidad de la agenda desde la Note 'Synckre Availability' de ERPNext.

        Formato del contenido (JSON): {"days": "1,2,3,4,5", "hours": "10,15", "timezone": "UTC", "duration": 30}
        Devuelve {} si no existe o no es JSON válido (el llamador usa el fallback de config).
        """
        if not self.is_configured():
            return {}
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Note",
                params={
                    "filters": self._filters([["title", "=", "Synckre Availability"]]),
                    "fields": '["title","content"]',
                    "limit_page_length": 1,
                },
                headers=self._headers(),
            )
            if resp.status_code < 300:
                rows = (resp.json() or {}).get("data") or []
                if rows:
                    contenido = rows[0].get("content") or ""
                    try:
                        cfg = json.loads(contenido)
                        return cfg if isinstance(cfg, dict) else {}
                    except Exception:
                        logger.warning("Note 'Synckre Availability' no contiene JSON válido.")
                        return {}
        except Exception as exc:
            logger.warning("No se pudo leer la disponibilidad de ERPNext: %s", exc)
        return {}

    async def _google_calendar_name(self) -> str:
        """Nombre del Google Calendar configurado en ERPNext (env o descubrimiento)."""
        override = (settings.ERPNEXT_GOOGLE_CALENDAR or "").strip()
        if override:
            return override
        if not self.is_configured():
            return ""
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Google%20Calendar",
                params={"limit_page_length": 5},
                headers=self._headers(),
            )
            if resp.status_code < 300:
                rows = (resp.json() or {}).get("data") or []
                if rows:
                    return str(rows[0].get("name") or "")
        except Exception as exc:
            logger.warning("No se pudo descubrir el Google Calendar de ERPNext: %s", exc)
        return ""

    async def list_events(self, *, start: str = "", end: str = "", limit: int = 50) -> Dict[str, Any]:
        """Lista eventos próximos de la agenda (filtro opcional por rango de fechas)."""
        filters = []
        if start:
            filters.append(["starts_on", ">=", start])
        if end:
            filters.append(["starts_on", "<=", end])
        params = {
            "fields": '["name","subject","starts_on","ends_on","description","status"]',
            "limit_page_length": limit,
            "order_by": "starts_on asc",
        }
        if filters:
            params["filters"] = self._filters(filters)
        try:
            if not self.is_configured():
                return {"ok": False, "error": self._error("Event"), "events": []}
            resp = await self._http().get(
                f"{self.base}/api/resource/Event",
                params=params,
                headers=self._headers(),
            )
        except Exception as exc:
            logger.error("ERPNext list events falló: %s", exc)
            return {"ok": False, "error": f"ERPNext no responde ({exc}).", "events": []}
        if resp.status_code >= 300:
            return {"ok": False, "error": f"ERPNext respondió {resp.status_code}.", "events": []}
        return {"ok": True, "events": (resp.json() or {}).get("data", []), "error": ""}

    async def cancel_event(self, event_id: str) -> Dict[str, Any]:
        """Marca un evento como cancelado en ERPNext."""
        return await self._request("PUT", f"Event/{event_id}", json={"status": "Cancelled"})

    # ---------------------------------------------------------------
    # CRM (Customer / Lead)
    # ---------------------------------------------------------------
    async def create_customer(
        self,
        *,
        customer_name: str,
        email_id: str = "",
        mobile_no: str = "",
        customer_group: str = "",
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"customer_name": customer_name}
        if email_id:
            payload["email_id"] = email_id
        if mobile_no:
            payload["mobile_no"] = mobile_no
        if customer_group:
            payload["customer_group"] = customer_group
        res = await self._request("POST", "Customer", json=payload)
        if not res["ok"]:
            return {"ok": False, "error": res["error"], "customer_id": ""}
        return {"ok": True, "customer_id": str((res.get("data") or {}).get("name") or "")}

    async def create_lead(
        self,
        *,
        lead_name: str,
        email_id: str,
        company_name: str = "",
        mobile_no: str = "",
        notes: str = "",
        source: str = "Website",
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "lead_name": lead_name,
            "email_id": email_id,
            "company_name": company_name,
            "mobile_no": mobile_no,
        }
        if notes:
            payload["notes"] = [
                {
                    "added_by": _LEAD_NOTES_BY,
                    "added_on": _frappe_dt(datetime.now(timezone.utc).isoformat()),
                    "note": str(notes)[:5000],
                }
            ]
        # NOTA: el campo 'source' del Lead es un Link a 'Lead Source' (doctype); no se envía
        # para evitar errores si el valor no existe como registro en ERPNext.
        res = await self._request("POST", "Lead", json=payload)
        if res["ok"]:
            return {"ok": True, "lead_id": str((res.get("data") or {}).get("name") or "")}

        # Email duplicado: buscar el lead existente y reutilizarlo
        existing = await self._find_lead_by_email(email_id)
        if existing:
            return {"ok": True, "lead_id": existing, "duplicate": True}
        return {"ok": False, "error": res["error"], "lead_id": ""}

    async def add_lead_note(self, lead_id: str, note: str) -> Dict[str, Any]:
        """Añade una nota (tabla hija 'notes' del Lead) conservando las existentes."""
        if not lead_id or not note or not self.is_configured():
            return {"ok": False, "error": self._error("Lead note")}
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Lead/{lead_id}",
                headers=self._headers(),
            )
            if resp.status_code >= 300:
                return {"ok": False, "error": f"Lead no encontrado (HTTP {resp.status_code})."}
            data = resp.json().get("data") or {}
            notas = [n for n in (data.get("notes") or []) if isinstance(n, dict) and n.get("note")]
            notas.append(
                {
                    "added_by": _LEAD_NOTES_BY,
                    "added_on": _frappe_dt(datetime.now(timezone.utc).isoformat()),
                    "note": str(note)[:5000],
                }
            )
            res = await self._request("PUT", f"Lead/{lead_id}", json={"notes": notas})
            return res if res["ok"] else {"ok": False, "error": res["error"]}
        except Exception as exc:
            logger.error("ERPNext add_lead_note falló: %s", exc)
            return {"ok": False, "error": f"ERPNext no responde ({exc})."}

    async def delete_lead(self, lead_id: str) -> Dict[str, Any]:
        """Elimina un Lead de ERPNext (usado al unificar leads duplicados)."""
        if not lead_id or not self.is_configured():
            return {"ok": False, "error": self._error("Lead")}
        return await self._request("DELETE", f"Lead/{lead_id}")

    async def _find_lead_by_email(self, email_id: str) -> str:
        """Busca un Lead existente por email_id."""
        if not email_id or not self.is_configured():
            return ""
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Lead",
                params={
                    "filters": self._filters([["email_id", "=", email_id]]),
                    "fields": '["name"]',
                    "limit_page_length": 1,
                },
                headers=self._headers(),
            )
            if resp.status_code < 300:
                rows = (resp.json() or {}).get("data") or []
                return str(rows[0].get("name") or "") if rows else ""
        except Exception as exc:
            logger.warning("No se pudo buscar el Lead por email: %s", exc)
        return ""

    async def get_lead(self, email_id: str) -> Dict[str, Any]:
        """Busca un Lead en ERPNext por email y devuelve sus datos maestros.

        ERPNext es la fuente de verdad de los leads: la memoria local solo
        guarda notas; los datos del lead (nombre, empresa, teléfono, status) se
        leen de aquí para construir el contexto del LLM.
        """
        if not email_id or not self.is_configured():
            return {"ok": False, "error": self._error("Lead"), "lead": {}}
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Lead",
                params={
                    "filters": self._filters([["email_id", "=", email_id]]),
                    "fields": '["name","lead_name","email_id","company_name","mobile_no","status","source","creation"]',
                    "limit_page_length": 1,
                },
                headers=self._headers(),
                timeout=_CONTEXT_TIMEOUT,
            )
            rows = (resp.json() or {}).get("data") or []
            if resp.status_code < 300 and rows:
                return {"ok": True, "lead": rows[0], "error": ""}
            return {"ok": False, "error": "Lead no encontrado en ERPNext.", "lead": {}}
        except Exception as exc:
            logger.error("ERPNext get_lead falló: %s", exc)
            return {"ok": False, "error": f"ERPNext no responde ({exc}).", "lead": {}}

    async def get_invoice(self, invoice_id: str) -> Dict[str, Any]:
        """Lee una Sales Invoice de ERPNext (datos reales, no inventados)."""
        if not invoice_id or not self.is_configured():
            return {"ok": False, "error": self._error("Sales Invoice"), "invoice": {}}
        try:
            resp = await self._http().get(
                f"{self.base}/api/resource/Sales%20Invoice/{invoice_id}",
                params={
                    "fields": '["name","customer","customer_name","posting_date","grand_total","currency","status","outstanding_amount"]',
                },
                headers=self._headers(),
            )
            if resp.status_code < 300:
                return {"ok": True, "invoice": resp.json().get("data", {}), "error": ""}
            return {"ok": False, "error": f"Factura no encontrada (HTTP {resp.status_code}).", "invoice": {}}
        except Exception as exc:
            logger.error("ERPNext get_invoice falló: %s", exc)
            return {"ok": False, "error": f"ERPNext no responde ({exc}).", "invoice": {}}

    # Campos de Customer editables por update_customer (whitelist contra inyección de campos)
    UPDATE_CUSTOMER_FIELDS = {"customer_name", "email_id", "mobile_no", "customer_group", "website", "phone"}

    async def update_customer(self, customer_id: str, campo: str, valor: str) -> Dict[str, Any]:
        """Actualiza un campo concreto de un Customer en ERPNext (whitelist de campos)."""
        campo = (campo or "").strip()
        if campo not in self.UPDATE_CUSTOMER_FIELDS:
            return {"ok": False, "error": f"Campo no permitido para actualizar: '{campo}'."}
        if not customer_id or not self.is_configured():
            return {"ok": False, "error": self._error("Customer")}
        return await self._request("PUT", f"Customer/{customer_id}", json={campo: (valor or "")})

    async def update_lead(self, lead_id: str, email_id: str) -> Dict[str, Any]:
        """Corrige el email de un Lead en ERPNext (p.ej. cuando el cliente se equivocó al registrarse)."""
        if not lead_id or not email_id or not self.is_configured():
            return {"ok": False, "error": self._error("Lead")}
        return await self._request("PUT", f"Lead/{lead_id}", json={"email_id": email_id.strip()})

    async def create_issue(
        self,
        subject: str,
        description: str,
        email_id: str = "",
        customer: str = "",
    ) -> Dict[str, Any]:
        """Crea un Issue (ticket) en ERPNext y devuelve su id."""
        payload: Dict[str, Any] = {"subject": subject, "description": description}
        if email_id:
            payload["email_id"] = email_id
        if customer:
            payload["customer"] = customer
        res = await self._request("POST", "Issue", json=payload)
        if not res["ok"]:
            return {"ok": False, "error": res["error"], "issue_id": ""}
        return {"ok": True, "issue_id": str((res.get("data") or {}).get("name") or "")}

    async def update_issue(self, issue_id: str, status: str = "", priority: str = "") -> Dict[str, Any]:
        """Actualiza estado/prioridad de un Issue en ERPNext."""
        payload: Dict[str, Any] = {}
        if status:
            payload["status"] = status
        if priority:
            payload["priority"] = priority
        if not payload or not issue_id:
            return {"ok": False, "error": "Faltan issue_id o campos a actualizar."}
        return await self._request("PUT", f"Issue/{issue_id}", json=payload)

    async def add_issue_comment(self, issue_id: str, content: str) -> Dict[str, Any]:
        """Añade un comentario a un Issue (método Frappe add_comment)."""
        if not issue_id or not content or not self.is_configured():
            return {"ok": False, "error": self._error("Issue comment")}
        try:
            resp = await self._http().post(
                f"{self.base}/api/method/frappe.client.add_comment",
                headers=self._headers(),
                json={
                    "doctype": "Issue",
                    "name": issue_id,
                    "comment_type": "Comment",
                    "content": content[:2000],
                },
            )
            if resp.status_code < 300:
                return {"ok": True, "error": ""}
            return {"ok": False, "error": f"ERPNext respondió {resp.status_code}."}
        except Exception as exc:
            logger.error("ERPNext add_issue_comment falló: %s", exc)
            return {"ok": False, "error": f"ERPNext no responde ({exc})."}

    async def reschedule_event(self, event_id: str, starts_on: str, ends_on: str) -> Dict[str, Any]:
        """Cambia la fecha/hora de un Event en ERPNext."""
        if not event_id or not starts_on or not ends_on:
            return {"ok": False, "error": "Faltan event_id o nuevas fechas."}
        return await self._request(
            "PUT",
            f"Event/{event_id}",
            json={"starts_on": _frappe_dt(starts_on), "ends_on": _frappe_dt(ends_on)},
        )


erpnext_client = ERPNextClient()


async def guardar_lead(
    *,
    nombre: str,
    email: str,
    empresa: str = "",
    telefono: str = "",
    mensaje: str = "",
    origen: str = "web",
    workflow_id: str = "",
) -> dict[str, Any]:
    """Persiste el lead en Postgres y, si ERPNext está configurado, lo crea como Lead.

    El erp_id resultante se guarda en la memoria local (metadata) y se devuelve en la
    respuesta: es la clave para corregir el lead por su ID sin depender de coincidencias
    de email.
    """
    erp_id = ""
    destino = "local"
    res = await erpnext_client.create_lead(
        lead_name=nombre,
        email_id=email,
        company_name=empresa,
        mobile_no=telefono,
        notes=mensaje,
        source=origen or "Website",
    )
    if res.get("ok"):
        erp_id = res.get("lead_id") or ""
        destino = "erpnext"
    else:
        if erpnext_client.is_configured():
            destino = "local_erp_error"

    local_id = await db_manager.guardar_lead(
        nombre=nombre,
        email=email,
        empresa=empresa,
        telefono=telefono,
        mensaje=mensaje,
        origen=origen,
        workflow_id=workflow_id,
        erp_id=erp_id,
        erp_destino=destino,
    )
    return {
        "local_id": local_id,
        "erp_id": erp_id,
        "erp_destino": destino,
    }
