"""Poller de synckre.jobs: reclama con SKIP LOCKED y despacha por kind.

Los handlers de negocio (retry_tool, HITL) se registran después.
Un kind desconocido se marca failed para no girar en vacío.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Dict, Optional

from app.application.jobs import Job
from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.infrastructure.db.repos.jobs import JobStore

logger = logging.getLogger("job_scheduler")

JobHandler = Callable[[Job], Awaitable[None]]


class JobScheduler:
    def __init__(
        self,
        *,
        store: Optional[JobStore] = None,
        poll_seconds: Optional[int] = None,
        lock_timeout: Optional[timedelta] = None,
        batch_size: int = 20,
    ) -> None:
        self._store = store
        self._poll_seconds = poll_seconds if poll_seconds is not None else settings.JOB_POLL_SECONDS
        self._lock_timeout = lock_timeout or timedelta(seconds=settings.JOB_LOCK_TIMEOUT_SECONDS)
        self._batch_size = batch_size
        self._handlers: Dict[str, JobHandler] = {}
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    @property
    def store(self) -> JobStore:
        if self._store is None:
            return db_manager.jobs
        return self._store

    def register(self, kind: str, handler: JobHandler) -> None:
        self._handlers[kind] = handler

    async def enqueue(
        self,
        *,
        kind: str,
        payload: dict,
        run_at: Optional[datetime] = None,
        max_attempts: int = 5,
        idempotency_key: Optional[str] = None,
    ) -> Optional[Job]:
        return await self.store.enqueue(
            kind=kind,
            payload=payload,
            run_at=run_at,
            max_attempts=max_attempts,
            idempotency_key=idempotency_key,
        )

    async def process_due(self, now: Optional[datetime] = None) -> int:
        """Reclama y ejecuta un lote. Devuelve cuántos jobs se intentaron."""
        when = now or datetime.now(timezone.utc)
        claimed = await self.store.claim_due(
            now=when,
            limit=self._batch_size,
            lock_timeout=self._lock_timeout,
        )
        for job in claimed:
            await self._run_one(job)
        return len(claimed)

    async def _run_one(self, job: Job) -> None:
        handler = self._handlers.get(job.kind)
        if handler is None:
            logger.error("Job %s: kind desconocido '%s'", job.id, job.kind)
            await self.store.mark_failed(job.id, f"kind desconocido: {job.kind}")
            return
        try:
            await handler(job)
            await self.store.mark_done(job.id)
        except Exception as exc:
            logger.exception("Job %s falló: %s", job.id, exc)
            if job.attempts >= job.max_attempts:
                await self.store.mark_failed(job.id, str(exc))
                return
            backoff = min(2 ** max(job.attempts, 1), 300)
            run_at = datetime.now(timezone.utc) + timedelta(seconds=backoff)
            await self.store.mark_retry(job.id, run_at=run_at, error=str(exc))

    async def _run(self) -> None:
        logger.info("Scheduler de jobs corriendo (cada %ss)", self._poll_seconds)
        while not self._stop.is_set():
            try:
                await self.process_due()
            except Exception as exc:
                logger.error("Error en scheduler de jobs: %s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._poll_seconds)
            except asyncio.TimeoutError:
                pass

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


job_scheduler = JobScheduler()
