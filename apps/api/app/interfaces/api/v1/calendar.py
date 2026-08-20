"""
Endpoints de agenda y citas para Synckre Agent V2.
Expone los próximos eventos de la compañía (desde ERPNext o el almacén local).
"""

from fastapi import APIRouter, Depends
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.erp import erpnext_client
from app.interfaces.security import require_internal_key

router = APIRouter(prefix="/api/v1/calendar", tags=["Calendar / Agenda"], dependencies=[Depends(require_internal_key)])


@router.get("/events", summary="Próximas citas de la agenda de la compañía")
async def upcoming_events(limit: int = 50):
    # Fuente primaria: ERPNext (control de agenda de la compañía)
    res = await erpnext_client.list_events(limit=limit)
    if res["ok"]:
        return {"source": "erpnext", "events": res["events"], "note": ""}

    # Fallback: agenda local (recordatorios programados)
    local = await db_manager.list_upcoming_appointments(limit=limit)
    return {"source": "local", "events": local, "note": res["error"]}
