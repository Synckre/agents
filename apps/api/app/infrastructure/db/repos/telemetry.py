"""Audit, tool executions, agent_runs y series Prometheus. Sin texto de chat."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from app.infrastructure.db.repos.base import BaseRepository

logger = logging.getLogger("db.telemetry")


class TelemetryRepository(BaseRepository):
    async def log_audit(
        self,
        *,
        agent_role: str,
        action: str,
        user_id: Optional[str] = None,
        tool_name: Optional[str] = None,
        task_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        input_summary: Optional[str] = None,
        output_summary: Optional[str] = None,
        authorization_result: str = "authorized",
        approval_id: Optional[str] = None,
    ) -> None:
        if not await self._ready():
            return
        sql = """
        INSERT INTO synckre.audit_logs
            (user_id, agent_role, tool_name, task_id, workflow_id, action, input_summary, output_summary, authorization_result, approval_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    sql,
                    (
                        user_id,
                        agent_role,
                        tool_name,
                        task_id,
                        workflow_id,
                        action,
                        input_summary,
                        output_summary,
                        authorization_result,
                        approval_id,
                    ),
                )
        except Exception as e:
            logger.error("Error guardando audit log: %s", e)

    async def log_tool_execution(
        self,
        *,
        conversation_id: str,
        tool_name: str,
        input_data: Dict[str, Any],
        output_data: Optional[Dict[str, Any]] = None,
        task_id: Optional[str] = None,
        status: str = "success",
        execution_time_ms: int = 0,
    ) -> None:
        if not await self._ready():
            return
        sql = """
        INSERT INTO synckre.tool_executions
            (id, task_id, conversation_id, tool_name, input_data, output_data, status, execution_time_ms)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
        """
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    sql,
                    (
                        f"TEX-{uuid.uuid4().hex[:8]}",
                        task_id,
                        conversation_id,
                        tool_name,
                        json.dumps(input_data),
                        json.dumps(output_data) if output_data else None,
                        status,
                        execution_time_ms,
                    ),
                )
        except Exception as e:
            logger.error("Error guardando tool execution: %s", e)

    async def find_by_idempotency_key(self, key: str) -> Optional[Dict[str, Any]]:
        if not key or not await self._ready():
            return None
        from psycopg.rows import dict_row

        sql = """
        SELECT output_data
        FROM synckre.tool_executions
        WHERE input_data->>'_idempotency_key' = %s AND status = 'success'
        ORDER BY created_at DESC
        LIMIT 1;
        """
        try:
            async with self.pool.connection() as conn:
                async with conn.cursor(row_factory=dict_row) as cur:
                    await cur.execute(sql, (key,))
                    row = await cur.fetchone()
            if not row or row.get("output_data") is None:
                return None
            data = row["output_data"]
            if isinstance(data, str):
                data = json.loads(data)
            return dict(data) if isinstance(data, dict) else None
        except Exception as e:
            logger.error("Error buscando ejecución idempotente: %s", e)
            return None

    async def persist_run(
        self,
        *,
        run_id: str,
        conversation_id: Optional[str],
        role: str,
        channel: str,
        outcome: str,
        llm_calls: int = 0,
        llm_failures: int = 0,
        llm_latency_ms: int = 0,
        used_fallback: bool = False,
        tool_calls: int = 0,
        used_rag: bool = False,
        rag_chunks: int = 0,
        policy_denied: bool = False,
        duration_ms: int = 0,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        llm_events: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        if not await self._ready():
            return
        run_sql = """
        INSERT INTO synckre.agent_runs (
            id, conversation_id, role, channel, outcome,
            llm_calls, llm_failures, llm_latency_ms, used_fallback,
            tool_calls, used_rag, rag_chunks, policy_denied,
            duration_ms, prompt_tokens, completion_tokens
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """
        llm_sql = """
        INSERT INTO synckre.llm_calls (
            id, run_id, conversation_id, role, phase, status,
            latency_ms, prompt_tokens, completion_tokens, http_status, attempt
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    run_sql,
                    (
                        run_id,
                        conversation_id,
                        role,
                        channel or "api",
                        outcome,
                        llm_calls,
                        llm_failures,
                        llm_latency_ms,
                        used_fallback,
                        tool_calls,
                        used_rag,
                        rag_chunks,
                        policy_denied,
                        duration_ms,
                        prompt_tokens,
                        completion_tokens,
                    ),
                )
                events = llm_events or []
                if events:
                    rows = [
                        (
                            f"LLM-{uuid.uuid4().hex[:10]}",
                            run_id,
                            conversation_id,
                            role,
                            ev.get("phase") or "plan",
                            ev.get("status") or "unknown",
                            int(ev.get("latency_ms") or 0),
                            int(ev.get("prompt_tokens") or 0),
                            int(ev.get("completion_tokens") or 0),
                            ev.get("http_status"),
                            int(ev.get("attempt") or 1),
                        )
                        for ev in events
                    ]
                    await conn.executemany(llm_sql, rows)
        except Exception as e:
            logger.error("Error persistiendo telemetría del agente: %s", e)

    async def list_tool_executions(
        self,
        conversation_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        if not await self._ready():
            return []
        if conversation_id:
            sql = """
            SELECT id, task_id, conversation_id, tool_name, input_data, output_data,
                   status, execution_time_ms, created_at
            FROM synckre.tool_executions
            WHERE conversation_id = %s
            ORDER BY created_at DESC
            LIMIT %s;
            """
            params = (conversation_id, limit)
        else:
            sql = """
            SELECT id, task_id, conversation_id, tool_name, input_data, output_data,
                   status, execution_time_ms, created_at
            FROM synckre.tool_executions
            ORDER BY created_at DESC
            LIMIT %s;
            """
            params = (limit,)
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()
                return [
                    {
                        "id": r[0],
                        "task_id": r[1],
                        "conversation_id": r[2],
                        "tool_name": r[3],
                        "input_data": r[4] if isinstance(r[4], dict) else json.loads(r[4] or "{}"),
                        "output_data": r[5] if isinstance(r[5], dict) else (json.loads(r[5]) if r[5] else None),
                        "status": r[6],
                        "execution_time_ms": r[7],
                        "created_at": r[8].isoformat() if r[8] else None,
                    }
                    for r in rows
                ]

    async def list_audit_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        if not await self._ready():
            return []
        sql = """
        SELECT id, user_id, agent_role, tool_name, task_id, workflow_id, action,
               input_summary, output_summary, authorization_result, approval_id, timestamp
        FROM synckre.audit_logs
        ORDER BY timestamp DESC
        LIMIT %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (limit,))
                rows = await cur.fetchall()
                return [
                    {
                        "id": r[0],
                        "user_id": r[1],
                        "agent_role": r[2],
                        "tool_name": r[3],
                        "task_id": r[4],
                        "workflow_id": r[5],
                        "action": r[6],
                        "input_summary": r[7],
                        "output_summary": r[8],
                        "authorization_result": r[9],
                        "approval_id": r[10],
                        "timestamp": r[11].isoformat() if r[11] else None,
                    }
                    for r in rows
                ]

    async def stats(self) -> Dict[str, Any]:
        empty = {
            "erp_mutations": 0,
            "calendar_bookings": 0,
            "emails_sent": 0,
            "rag_queries": 0,
            "total_executions": 0,
            "failed_executions": 0,
            "avg_execution_time_ms": 0.0,
            "agent_runs_total": 0,
            "agent_runs_1h": 0,
            "agent_runs_24h": 0,
            "avg_run_duration_ms": 0.0,
            "p95_run_duration_ms": 0.0,
            "llm_calls_total": 0,
            "llm_failures_total": 0,
            "llm_fallback_total": 0,
            "prompt_tokens_total": 0,
            "completion_tokens_total": 0,
            "pending_approvals": 0,
            "active_conversations": 0,
            "paused_human_conversations": 0,
            "hitl_runs": 0,
            "guardrail_blocks": 0,
        }
        if not await self._ready():
            return empty
        tool_sql = """
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status NOT IN ('success') THEN 1 ELSE 0 END), 0) AS failed,
            COALESCE(AVG(execution_time_ms), 0) AS avg_ms,
            COALESCE(SUM(CASE WHEN tool_name IN ('create_lead', 'create_customer', 'update_customer') THEN 1 ELSE 0 END), 0) AS erp,
            COALESCE(SUM(CASE WHEN tool_name IN ('create_event', 'reschedule_event') THEN 1 ELSE 0 END), 0) AS calendar,
            COALESCE(SUM(CASE WHEN tool_name = 'send_email' THEN 1 ELSE 0 END), 0) AS email,
            COALESCE(SUM(CASE WHEN tool_name IN ('read_public_knowledge', 'read_internal_knowledge', 'search_documents') THEN 1 ELSE 0 END), 0) AS rag
        FROM synckre.tool_executions;
        """
        run_sql = """
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END), 0) AS last_1h,
            COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) AS last_24h,
            COALESCE(AVG(duration_ms), 0) AS avg_ms,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) AS p95_ms,
            COALESCE(SUM(llm_calls), 0) AS llm_calls,
            COALESCE(SUM(llm_failures), 0) AS llm_failures,
            COALESCE(SUM(CASE WHEN used_fallback THEN 1 ELSE 0 END), 0) AS fallbacks,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(CASE WHEN outcome = 'hitl' THEN 1 ELSE 0 END), 0) AS hitl,
            COALESCE(SUM(CASE WHEN outcome = 'guardrail_block' THEN 1 ELSE 0 END), 0) AS guardrails
        FROM synckre.agent_runs;
        """
        extra_sql = """
        SELECT
            (SELECT COUNT(*) FROM synckre.approvals WHERE status = 'pending') AS pending_approvals,
            (SELECT COUNT(*) FROM synckre.conversations WHERE status = 'active') AS active_conversations,
            (SELECT COUNT(*) FROM synckre.conversations WHERE status = 'paused_human') AS paused_human;
        """
        try:
            async with self.pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(tool_sql)
                    tool = await cur.fetchone()
                    await cur.execute(run_sql)
                    run = await cur.fetchone()
                    await cur.execute(extra_sql)
                    extra = await cur.fetchone()
            out = dict(empty)
            if tool:
                out.update(
                    {
                        "total_executions": int(tool[0]),
                        "failed_executions": int(tool[1]),
                        "avg_execution_time_ms": float(tool[2] or 0),
                        "erp_mutations": int(tool[3]),
                        "calendar_bookings": int(tool[4]),
                        "emails_sent": int(tool[5]),
                        "rag_queries": int(tool[6]),
                    }
                )
            if run:
                out.update(
                    {
                        "agent_runs_total": int(run[0]),
                        "agent_runs_1h": int(run[1]),
                        "agent_runs_24h": int(run[2]),
                        "avg_run_duration_ms": float(run[3] or 0),
                        "p95_run_duration_ms": float(run[4] or 0),
                        "llm_calls_total": int(run[5]),
                        "llm_failures_total": int(run[6]),
                        "llm_fallback_total": int(run[7]),
                        "prompt_tokens_total": int(run[8]),
                        "completion_tokens_total": int(run[9]),
                        "hitl_runs": int(run[10]),
                        "guardrail_blocks": int(run[11]),
                    }
                )
            if extra:
                out.update(
                    {
                        "pending_approvals": int(extra[0] or 0),
                        "active_conversations": int(extra[1] or 0),
                        "paused_human_conversations": int(extra[2] or 0),
                    }
                )
            return out
        except Exception as e:
            logger.error("Error cargando estadísticas de telemetría: %s", e)
        return empty

    async def series(self) -> Dict[str, List[Dict[str, Any]]]:
        empty: Dict[str, List[Dict[str, Any]]] = {
            "agent_runs": [],
            "run_latency": [],
            "llm_calls": [],
            "tools": [],
            "conversations": [],
            "messages": [],
            "tasks": [],
            "approvals": [],
            "knowledge_sources": [],
            "document_chunks": [],
            "windows": [],
        }
        if not await self._ready():
            return empty
        queries = {
            "agent_runs": """
                SELECT COALESCE(role, 'unknown') AS role,
                       COALESCE(outcome, 'unknown') AS outcome,
                       COALESCE(channel, 'api') AS channel,
                       COUNT(*)::bigint AS count
                FROM synckre.agent_runs GROUP BY 1, 2, 3
            """,
            "run_latency": """
                SELECT COALESCE(role, 'unknown') AS role,
                       COALESCE(AVG(duration_ms), 0) AS avg_ms,
                       COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms), 0) AS p50_ms,
                       COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) AS p95_ms
                FROM synckre.agent_runs GROUP BY 1
            """,
            "llm_calls": """
                SELECT COALESCE(phase, 'plan') AS phase,
                       COALESCE(status, 'unknown') AS status,
                       COUNT(*)::bigint AS count,
                       COALESCE(AVG(latency_ms), 0) AS avg_ms,
                       COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
                       COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens
                FROM synckre.llm_calls GROUP BY 1, 2
            """,
            "tools": """
                SELECT COALESCE(tool_name, 'unknown') AS tool,
                       COALESCE(status, 'unknown') AS status,
                       COUNT(*)::bigint AS count,
                       COALESCE(AVG(execution_time_ms), 0) AS avg_ms
                FROM synckre.tool_executions GROUP BY 1, 2
            """,
            "conversations": """
                SELECT COALESCE(status, 'unknown') AS status,
                       COALESCE(role, 'unknown') AS role,
                       COALESCE(channel, 'api') AS channel,
                       COUNT(*)::bigint AS count
                FROM synckre.conversations GROUP BY 1, 2, 3
            """,
            "messages": """
                SELECT COALESCE(sender, 'unknown') AS sender, COUNT(*)::bigint AS count
                FROM synckre.messages GROUP BY 1
            """,
            "tasks": """
                SELECT COALESCE(status, 'unknown') AS status,
                       COALESCE(type, 'unknown') AS type,
                       COUNT(*)::bigint AS count
                FROM synckre.tasks GROUP BY 1, 2
            """,
            "approvals": """
                SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::bigint AS count
                FROM synckre.approvals GROUP BY 1
            """,
            "knowledge_sources": """
                SELECT COALESCE(domain, 'unknown') AS domain,
                       COALESCE(status, 'unknown') AS status,
                       COUNT(*)::bigint AS count
                FROM synckre.knowledge_sources GROUP BY 1, 2
            """,
            "document_chunks": """
                SELECT COALESCE(domain, 'unknown') AS domain, COUNT(*)::bigint AS count
                FROM synckre.document_chunks GROUP BY 1
            """,
            "windows": """
                SELECT
                    COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '5 minutes' THEN 1 ELSE 0 END), 0)::bigint AS m5,
                    COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END), 0)::bigint AS h1,
                    COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)::bigint AS h24
                FROM synckre.agent_runs
            """,
        }
        series = dict(empty)
        from psycopg.rows import dict_row

        try:
            async with self.pool.connection() as conn:
                async with conn.cursor(row_factory=dict_row) as cur:
                    for key, sql in queries.items():
                        try:
                            await cur.execute(sql)
                            rows = await cur.fetchall()
                            series[key] = [dict(r) for r in rows]
                        except Exception as e:
                            logger.error("Error en serie de observabilidad '%s': %s", key, e)
        except Exception as e:
            logger.error("Error cargando series de observabilidad: %s", e)
        return series
