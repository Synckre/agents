"""Persistencia de synckre.jobs."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Protocol

from psycopg.types.json import Json

from app.application.jobs import Job, JobStatus
from app.infrastructure.db.repos.base import BaseRepository


class JobStore(Protocol):
    async def enqueue(
        self,
        *,
        kind: str,
        payload: Dict[str, Any],
        run_at: Optional[datetime] = None,
        max_attempts: int = 5,
        idempotency_key: Optional[str] = None,
    ) -> Optional[Job]: ...

    async def claim_due(
        self,
        *,
        now: datetime,
        limit: int = 20,
        lock_timeout: timedelta,
    ) -> list[Job]: ...

    async def mark_done(self, job_id: str) -> None: ...

    async def mark_retry(self, job_id: str, *, run_at: datetime, error: str) -> None: ...

    async def mark_failed(self, job_id: str, error: str) -> None: ...

    async def get(self, job_id: str) -> Optional[Job]: ...


def _row_to_job(row: Dict[str, Any]) -> Job:
    payload = row.get("payload") or {}
    if isinstance(payload, str):
        payload = json.loads(payload)
    return Job(
        id=row["id"],
        kind=row["kind"],
        run_at=row["run_at"],
        payload=dict(payload),
        status=row["status"],
        attempts=int(row["attempts"] or 0),
        max_attempts=int(row["max_attempts"] or 5),
        locked_at=row.get("locked_at"),
        idempotency_key=row.get("idempotency_key"),
        last_error=row.get("last_error"),
        created_at=row.get("created_at") or datetime.now(timezone.utc),
        updated_at=row.get("updated_at") or datetime.now(timezone.utc),
    )


class JobsRepository(BaseRepository):
    async def enqueue(
        self,
        *,
        kind: str,
        payload: Dict[str, Any],
        run_at: Optional[datetime] = None,
        max_attempts: int = 5,
        idempotency_key: Optional[str] = None,
    ) -> Optional[Job]:
        if not await self._ready():
            return None
        job_id = f"JOB-{uuid.uuid4().hex[:12]}"
        when = run_at or datetime.now(timezone.utc)
        sql = """
        INSERT INTO synckre.jobs (
            id, kind, run_at, payload, status, attempts, max_attempts, idempotency_key
        ) VALUES (%s, %s, %s, %s, %s, 0, %s, %s)
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING id, kind, run_at, payload, status, attempts, max_attempts,
                  locked_at, idempotency_key, last_error, created_at, updated_at;
        """
        from psycopg.rows import dict_row

        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    sql,
                    (
                        job_id,
                        kind,
                        when,
                        Json(payload),
                        JobStatus.pending.value,
                        max_attempts,
                        idempotency_key,
                    ),
                )
                row = await cur.fetchone()
        if not row:
            if idempotency_key:
                existing = await self.get_by_idempotency_key(idempotency_key)
                return existing
            return None
        return _row_to_job(dict(row))

    async def get(self, job_id: str) -> Optional[Job]:
        if not await self._ready():
            return None
        from psycopg.rows import dict_row

        sql = """
        SELECT id, kind, run_at, payload, status, attempts, max_attempts,
               locked_at, idempotency_key, last_error, created_at, updated_at
        FROM synckre.jobs WHERE id = %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(sql, (job_id,))
                row = await cur.fetchone()
        return _row_to_job(dict(row)) if row else None

    async def get_by_idempotency_key(self, key: str) -> Optional[Job]:
        if not await self._ready():
            return None
        from psycopg.rows import dict_row

        sql = """
        SELECT id, kind, run_at, payload, status, attempts, max_attempts,
               locked_at, idempotency_key, last_error, created_at, updated_at
        FROM synckre.jobs WHERE idempotency_key = %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(sql, (key,))
                row = await cur.fetchone()
        return _row_to_job(dict(row)) if row else None

    async def claim_due(
        self,
        *,
        now: datetime,
        limit: int = 20,
        lock_timeout: timedelta,
    ) -> list[Job]:
        """Pasa pending (o running con lock caducado) a running. SKIP LOCKED."""
        if not await self._ready():
            return []
        stale_before = now - lock_timeout
        from psycopg.rows import dict_row

        sql = """
        UPDATE synckre.jobs AS j
        SET status = 'running',
            locked_at = %s,
            attempts = j.attempts + 1,
            updated_at = %s
        FROM (
            SELECT id
            FROM synckre.jobs
            WHERE (
                (status = 'pending' AND run_at <= %s)
                OR (status = 'running' AND locked_at IS NOT NULL AND locked_at < %s)
            )
            ORDER BY run_at ASC
            LIMIT %s
            FOR UPDATE SKIP LOCKED
        ) AS due
        WHERE j.id = due.id
        RETURNING j.id, j.kind, j.run_at, j.payload, j.status, j.attempts, j.max_attempts,
                  j.locked_at, j.idempotency_key, j.last_error, j.created_at, j.updated_at;
        """
        async with self.pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor(row_factory=dict_row) as cur:
                    await cur.execute(sql, (now, now, now, stale_before, limit))
                    rows = await cur.fetchall()
        return [_row_to_job(dict(r)) for r in rows]

    async def mark_done(self, job_id: str) -> None:
        await self._set_status(job_id, JobStatus.done.value, error=None)

    async def mark_retry(self, job_id: str, *, run_at: datetime, error: str) -> None:
        if not await self._ready():
            return
        sql = """
        UPDATE synckre.jobs
        SET status = 'pending', run_at = %s, last_error = %s,
            locked_at = NULL, updated_at = %s
        WHERE id = %s;
        """
        async with self.pool.connection() as conn:
            await conn.execute(sql, (run_at, error[:1000], datetime.now(timezone.utc), job_id))

    async def mark_failed(self, job_id: str, error: str) -> None:
        await self._set_status(job_id, JobStatus.failed.value, error=error)

    async def list_jobs(self, status: Optional[str] = None, limit: int = 50) -> list[Job]:
        if not await self._ready():
            return []
        from psycopg.rows import dict_row

        if status:
            sql = """
            SELECT id, kind, run_at, payload, status, attempts, max_attempts,
                   locked_at, idempotency_key, last_error, created_at, updated_at
            FROM synckre.jobs
            WHERE status = %s
            ORDER BY created_at DESC
            LIMIT %s;
            """
            params = (status, limit)
        else:
            sql = """
            SELECT id, kind, run_at, payload, status, attempts, max_attempts,
                   locked_at, idempotency_key, last_error, created_at, updated_at
            FROM synckre.jobs
            ORDER BY created_at DESC
            LIMIT %s;
            """
            params = (limit,)
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()
        return [_row_to_job(dict(r)) for r in rows]

    async def _set_status(self, job_id: str, status: str, error: Optional[str]) -> None:
        if not await self._ready():
            return
        sql = """
        UPDATE synckre.jobs
        SET status = %s, last_error = %s, locked_at = NULL, updated_at = %s
        WHERE id = %s;
        """
        async with self.pool.connection() as conn:
            await conn.execute(
                sql,
                (status, (error[:1000] if error else None), datetime.now(timezone.utc), job_id),
            )

