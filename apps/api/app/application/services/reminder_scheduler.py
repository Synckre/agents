"""
Scheduler asíncrono de recordatorios de citas.

Cada REMINDER_POLL_SECONDS revisa la tabla de recordatorios pendientes y envía
por Resend los correos cuyo scheduled_for ya venció (1 día antes y N minutos
antes de la cita). Los envíos fallidos quedan pendientes para reintentar.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.integrations.email import enviar_correo_html
from app.infrastructure.integrations.email_templates import email_recordatorio_cita

logger = logging.getLogger("reminder_scheduler")


class ReminderScheduler:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def _run(self) -> None:
        logger.info("Scheduler de recordatorios corriendo (cada %ss)", settings.REMINDER_POLL_SECONDS)
        while not self._stop.is_set():
            try:
                await self._process_due()
            except Exception as exc:
                logger.error("Error en scheduler de recordatorios: %s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=settings.REMINDER_POLL_SECONDS)
            except asyncio.TimeoutError:
                pass

    async def _process_due(self) -> None:
        now = datetime.now(timezone.utc)
        # Reclamación atómica: SELECT ... FOR UPDATE SKIP LOCKED dentro de una
        # transacción, y cada recordatorio se marca enviado/error en la misma
        # conexión antes de hacer commit (evita envíos duplicados entre polls).
        async with db_manager.pool.connection() as conn:
            async with conn.transaction():
                due = await db_manager.list_due_reminders(now, conn=conn)
                if not due:
                    return
                logger.info("Enviando %d recordatorio(s) vencido(s)", len(due))
                for rem in due:
                    try:
                        tipo = rem["reminder_type"]
                        asunto, html, texto = email_recordatorio_cita(
                            nombre=rem["client_name"] or "Cliente",
                            fecha_iso=rem["appointment_at"] or "",
                            motivo=rem.get("motivo") or "",
                            referencia=rem["event_id"] or "",
                            tipo="minutos" if tipo == "minutes_before" else "recordatorio",
                        )
                        res = await enviar_correo_html(rem["client_email"], asunto, html, texto)
                        ok = "enviado" in res.lower()
                        await db_manager.mark_reminder_sent(rem["id"], error=None if ok else res, conn=conn)
                        if not ok:
                            logger.warning("Recordatorio %s no enviado (se reintentará): %s", rem["id"], res)
                    except Exception as exc:
                        # Sin marcar como enviado: se reintenta en el siguiente ciclo
                        await db_manager.mark_reminder_sent(rem["id"], error=str(exc), conn=conn)
                        logger.error("Recordatorio %s falló: %s", rem["id"], exc)

    async def start(self) -> None:
        if self._task is None:
            self._stop = asyncio.Event()
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._stop.set()
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None


reminder_scheduler = ReminderScheduler()
