"""Cola de jobs: claim, retry, kind desconocido, idempotencia (store en memoria)."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.application.jobs import Job, JobKind, JobStatus
from app.application.services.job_scheduler import JobScheduler


def _now() -> datetime:
    return datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)


class InMemoryJobStore:
    def __init__(self) -> None:
        self.jobs: Dict[str, Job] = {}
        self._seq = 0

    def _next_id(self) -> str:
        self._seq += 1
        return f"JOB-{self._seq}"

    async def enqueue(
        self,
        *,
        kind: str,
        payload: Dict[str, Any],
        run_at: Optional[datetime] = None,
        max_attempts: int = 5,
        idempotency_key: Optional[str] = None,
    ) -> Optional[Job]:
        if idempotency_key:
            for existing in self.jobs.values():
                if existing.idempotency_key == idempotency_key:
                    return existing
        job = Job(
            id=self._next_id(),
            kind=kind,
            run_at=run_at or _now(),
            payload=payload,
            max_attempts=max_attempts,
            idempotency_key=idempotency_key,
            created_at=_now(),
            updated_at=_now(),
        )
        self.jobs[job.id] = job
        return job

    async def claim_due(
        self,
        *,
        now: datetime,
        limit: int = 20,
        lock_timeout: timedelta,
    ) -> list[Job]:
        claimed: list[Job] = []
        stale_before = now - lock_timeout
        due = []
        for job in self.jobs.values():
            if job.status == JobStatus.pending.value and job.run_at <= now:
                due.append(job)
            elif (
                job.status == JobStatus.running.value
                and job.locked_at is not None
                and job.locked_at < stale_before
            ):
                due.append(job)
        due.sort(key=lambda j: j.run_at)
        for job in due[:limit]:
            job.status = JobStatus.running.value
            job.locked_at = now
            job.attempts += 1
            job.updated_at = now
            claimed.append(job)
        return claimed

    async def mark_done(self, job_id: str) -> None:
        job = self.jobs[job_id]
        job.status = JobStatus.done.value
        job.locked_at = None

    async def mark_retry(self, job_id: str, *, run_at: datetime, error: str) -> None:
        job = self.jobs[job_id]
        job.status = JobStatus.pending.value
        job.run_at = run_at
        job.last_error = error
        job.locked_at = None

    async def mark_failed(self, job_id: str, error: str) -> None:
        job = self.jobs[job_id]
        job.status = JobStatus.failed.value
        job.last_error = error
        job.locked_at = None

    async def get(self, job_id: str) -> Optional[Job]:
        return self.jobs.get(job_id)


def test_unknown_kind_marks_failed():
    store = InMemoryJobStore()
    scheduler = JobScheduler(store=store, poll_seconds=1, lock_timeout=timedelta(minutes=5))

    async def _run():
        job = await scheduler.enqueue(kind="no_existe", payload={})
        n = await scheduler.process_due(now=_now())
        return job, n

    job, n = asyncio.run(_run())
    assert n == 1
    assert store.jobs[job.id].status == JobStatus.failed.value
    assert "desconocido" in (store.jobs[job.id].last_error or "")


def test_handler_success_marks_done():
    store = InMemoryJobStore()
    scheduler = JobScheduler(store=store, poll_seconds=1, lock_timeout=timedelta(minutes=5))
    seen: list[str] = []

    async def handle(job: Job) -> None:
        seen.append(job.id)

    scheduler.register(JobKind.retry_tool.value, handle)

    async def _run():
        job = await scheduler.enqueue(kind=JobKind.retry_tool.value, payload={"tool": "create_lead"})
        await scheduler.process_due(now=_now())
        return job

    job = asyncio.run(_run())
    assert seen == [job.id]
    assert store.jobs[job.id].status == JobStatus.done.value


def test_handler_error_retries_until_max_attempts():
    store = InMemoryJobStore()
    scheduler = JobScheduler(store=store, poll_seconds=1, lock_timeout=timedelta(minutes=5))

    async def boom(_job: Job) -> None:
        raise RuntimeError("erp caído")

    scheduler.register(JobKind.retry_tool.value, boom)

    async def _run():
        job = await scheduler.enqueue(
            kind=JobKind.retry_tool.value,
            payload={},
            max_attempts=2,
        )
        await scheduler.process_due(now=_now())
        assert store.jobs[job.id].status == JobStatus.pending.value
        store.jobs[job.id].run_at = _now()
        await scheduler.process_due(now=_now())
        return job

    job = asyncio.run(_run())
    assert store.jobs[job.id].status == JobStatus.failed.value
    assert store.jobs[job.id].attempts == 2
    assert "erp caído" in (store.jobs[job.id].last_error or "")


def test_idempotency_key_returns_same_job():
    store = InMemoryJobStore()
    scheduler = JobScheduler(store=store, poll_seconds=1)

    async def _run():
        a = await scheduler.enqueue(
            kind=JobKind.resume_turn.value,
            payload={"conversation_id": "C1"},
            idempotency_key="resume:C1:APP-1",
        )
        b = await scheduler.enqueue(
            kind=JobKind.resume_turn.value,
            payload={"conversation_id": "C1"},
            idempotency_key="resume:C1:APP-1",
        )
        return a, b

    a, b = asyncio.run(_run())
    assert a.id == b.id
    assert len(store.jobs) == 1


def test_stale_running_job_is_reclaimed():
    store = InMemoryJobStore()
    scheduler = JobScheduler(store=store, poll_seconds=1, lock_timeout=timedelta(minutes=5))
    ran = []

    async def handle(job: Job) -> None:
        ran.append(job.id)

    scheduler.register(JobKind.follow_up.value, handle)

    async def _run():
        job = await scheduler.enqueue(kind=JobKind.follow_up.value, payload={})
        job.status = JobStatus.running.value
        job.locked_at = _now() - timedelta(minutes=10)
        job.attempts = 1
        await scheduler.process_due(now=_now())
        return job

    job = asyncio.run(_run())
    assert ran == [job.id]
    assert store.jobs[job.id].status == JobStatus.done.value
    assert store.jobs[job.id].attempts == 2
