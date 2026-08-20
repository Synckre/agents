"""
DatabaseManager para Synckre Agent V2.
Maneja el pool de conexiones asíncronas PostgreSQL (psycopg_pool), inicializa las tablas del esquema 'synckre'
y provee operaciones CRUD para conversaciones, mensajes, tareas, aprobaciones, auditoría y RAG vectorial.
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from psycopg_pool import AsyncConnectionPool

from app.infrastructure.config import settings
from app.infrastructure.db.schema import SETUP_SCHEMA_SQL
from app.domain import (
    ApprovalModel,
    ApprovalStatus,
    ContractModel,
    ConversationModel,
    CustomerModel,
    MessageModel,
    TaskModel,
    TaskStatus,
)

logger = logging.getLogger("db_manager")


class DatabaseManager:
    def __init__(self):
        self.pool: Optional[AsyncConnectionPool] = None

    async def connect(self):
        if self.pool and not self.pool.closed:
            return
        try:
            logger.info("Conectando a PostgreSQL para Synckre Agent V2...")
            self.pool = AsyncConnectionPool(
                conninfo=settings.POSTGRES_URI,
                max_size=20,
                open=False,
                timeout=8,
                kwargs={"autocommit": True, "connect_timeout": 5},
            )
            await self.pool.open()
            await self._run_schema_setup()
            logger.info("Base de datos y esquema 'synckre' listos.")
        except Exception as e:
            logger.error(f"Error conectando a PostgreSQL: {e}")
            raise e

    async def _ensure_connected(self) -> bool:
        try:
            await self.connect()
            return bool(self.pool and not self.pool.closed)
        except Exception:
            return False

    async def _run_schema_setup(self):
        if not self.pool:
            return
        async with self.pool.connection() as conn:
            await conn.execute(SETUP_SCHEMA_SQL)

    async def disconnect(self):
        if self.pool:
            logger.info("Cerrando pool de PostgreSQL...")
            await self.pool.close()

    # ==========================================
    # CONVERSATIONS & MESSAGES
    # ==========================================

    async def create_conversation(self, conv: ConversationModel) -> ConversationModel:
        if not await self._ensure_connected():
            return conv
        sql = """
        INSERT INTO synckre.conversations
            (id, channel, user_id, customer_id, role, status, created_at, updated_at, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at,
            metadata = EXCLUDED.metadata;
        """
        async with self.pool.connection() as conn:
            await conn.execute(
                sql,
                (
                    conv.id,
                    conv.channel.value if hasattr(conv.channel, "value") else str(conv.channel),
                    conv.user_id,
                    conv.customer_id,
                    conv.role,
                    conv.status,
                    conv.created_at,
                    conv.updated_at,
                    json.dumps(conv.metadata),
                ),
            )
        return conv

    async def get_conversation(self, conversation_id: str) -> Optional[ConversationModel]:
        if not await self._ensure_connected():
            return None
        sql = """
        SELECT id, channel, user_id, customer_id, role, status, created_at, updated_at, metadata
        FROM synckre.conversations
        WHERE id = %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (conversation_id,))
                row = await cur.fetchone()
                if not row:
                    return None
                return ConversationModel(
                    id=row[0],
                    channel=row[1],
                    user_id=row[2],
                    customer_id=row[3],
                    role=row[4],
                    status=row[5],
                    created_at=row[6],
                    updated_at=row[7],
                    metadata=row[8] if isinstance(row[8], dict) else json.loads(row[8] or "{}"),
                )

    async def list_conversations(self, limit: int = 50) -> List[ConversationModel]:
        if not await self._ensure_connected():
            return []
        sql = """
        SELECT id, channel, user_id, customer_id, role, status, created_at, updated_at, metadata
        FROM synckre.conversations
        ORDER BY updated_at DESC
        LIMIT %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (limit,))
                rows = await cur.fetchall()
                return [
                    ConversationModel(
                        id=r[0],
                        channel=r[1],
                        user_id=r[2],
                        customer_id=r[3],
                        role=r[4],
                        status=r[5],
                        created_at=r[6],
                        updated_at=r[7],
                        metadata=r[8] if isinstance(r[8], dict) else json.loads(r[8] or "{}"),
                    )
                    for r in rows
                ]

    async def delete_conversation(self, conversation_id: str) -> bool:
        """Elimina una conversación y su historial (los mensajes y tareas se borran en cascada)."""
        if not await self._ensure_connected():
            return False
        sql = "DELETE FROM synckre.conversations WHERE id = %s;"
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (conversation_id,))
                return (cur.rowcount or 0) > 0

    async def update_conversation_status(self, conversation_id: str, status: str) -> bool:
        """Actualiza el estado de una conversación ('active', 'paused_human', 'closed')."""
        if not await self._ensure_connected():
            return False
        sql = "UPDATE synckre.conversations SET status = %s, updated_at = %s WHERE id = %s;"
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (status, datetime.utcnow(), conversation_id))
                return (cur.rowcount or 0) > 0

    async def update_conversation_role(self, conversation_id: str, role: str) -> bool:
        """Cambia el rol del agente que atiende la conversación (traspaso entre agentes)."""
        if not await self._ensure_connected():
            return False
        sql = "UPDATE synckre.conversations SET role = %s, updated_at = %s WHERE id = %s;"
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (role, datetime.utcnow(), conversation_id))
                return (cur.rowcount or 0) > 0

    async def get_lead_erp_id_by_email(self, email: str) -> str:
        """Devuelve el erp_id del lead guardado en la memoria local para ese email (si existe)."""
        if not await self._ensure_connected() or not email:
            return ""
        sql = """
        SELECT metadata->>'erp_id'
        FROM synckre.memory
        WHERE entity_type = 'lead' AND email = %s AND metadata->>'erp_id' <> ''
        ORDER BY id DESC
        LIMIT 1;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (email,))
                row = await cur.fetchone()
                return str(row[0]) if row and row[0] else ""

    async def get_lead_erp_id_for_conversation(self, conversation_id: str) -> str:
        """erp_id del lead asociado a la conversación.

        Fuente primaria: metadata de la conversación ('lead_erp_id'), que create_lead
        guarda al registrar. Es ROBUSTA ante cambios posteriores del email en la
        conversación. Respaldo: memoria local vía el email de la conversación.
        """
        if not await self._ensure_connected() or not conversation_id:
            return ""
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                # 1) metadata de la conversación (la fuente fiable)
                await cur.execute(
                    "SELECT metadata->>'lead_erp_id' FROM synckre.conversations WHERE id = %s;",
                    (conversation_id,),
                )
                row = await cur.fetchone()
                if row and row[0]:
                    return str(row[0])
                # 2) respaldo: memoria local por email de la conversación
                await cur.execute(
                    """
                    SELECT m.metadata->>'erp_id'
                    FROM synckre.memory m
                    JOIN synckre.conversations c ON c.metadata->>'customer_email' = m.email
                    WHERE c.id = %s AND m.entity_type = 'lead' AND m.metadata->>'erp_id' <> ''
                    ORDER BY m.id DESC
                    LIMIT 1;
                    """,
                    (conversation_id,),
                )
                row = await cur.fetchone()
                return str(row[0]) if row and row[0] else ""

    async def update_memory_lead_erp_id(self, old_erp_id: str, new_erp_id: str) -> bool:
        """Re-apunta el erp_id de las filas de memoria de un lead (tras unificar leads)."""
        if not await self._ensure_connected() or not old_erp_id or not new_erp_id:
            return False
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    """
                    UPDATE synckre.memory
                    SET metadata = jsonb_set(metadata, '{erp_id}', to_jsonb(%s::text), true)
                    WHERE entity_type = 'lead' AND metadata->>'erp_id' = %s;
                    """,
                    (new_erp_id, old_erp_id),
                )
            return True
        except Exception as exc:
            logger.error(f"Error re-apuntando erp_id de memoria {old_erp_id} -> {new_erp_id}: {exc}")
            return False

    async def update_memory_email(self, old_email: str, new_email: str) -> bool:
        """Reasigna la clave de email en la memoria local (corrección de email del contacto)."""
        if not await self._ensure_connected() or not old_email or not new_email:
            return False
        if old_email == new_email:
            return True
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    "UPDATE synckre.memory SET email = %s WHERE email = %s;",
                    (new_email, old_email),
                )
            return True
        except Exception as exc:
            logger.error(f"Error reasignando email de memoria {old_email} -> {new_email}: {exc}")
            return False

    async def update_conversation_metadata(self, conversation_id: str, metadata: Dict[str, Any]) -> bool:
        """Fusiona metadata en la conversación (p.ej. customer_email detectado)."""
        if not await self._ensure_connected():
            return False
        sql = "UPDATE synckre.conversations SET metadata = metadata || %s::jsonb, updated_at = %s WHERE id = %s;"
        try:
            async with self.pool.connection() as conn:
                await conn.execute(sql, (json.dumps(metadata), datetime.utcnow(), conversation_id))
            return True
        except Exception as exc:
            logger.error(f"Error actualizando metadata de conversación: {exc}")
            return False

    async def add_message(self, msg: MessageModel) -> MessageModel:
        if not await self._ensure_connected():
            return msg
        sql = """
        INSERT INTO synckre.messages
            (id, conversation_id, sender, content, message_type, tool_calls, created_at, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
        """
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute(
                    sql,
                    (
                        msg.id,
                        msg.conversation_id,
                        msg.sender,
                        msg.content,
                        msg.message_type,
                        json.dumps(msg.tool_calls or []),
                        msg.created_at,
                        json.dumps(msg.metadata),
                    ),
                )
                # Actualizar updated_at de la conversación (atómico con el INSERT)
                await conn.execute(
                    "UPDATE synckre.conversations SET updated_at = %s WHERE id = %s;",
                    (msg.created_at, msg.conversation_id),
                )
        return msg

    async def get_messages(self, conversation_id: str, limit: int = 50) -> List[MessageModel]:
        if not await self._ensure_connected():
            return []
        sql = """
        SELECT id, conversation_id, sender, content, message_type, tool_calls, created_at, metadata
        FROM synckre.messages
        WHERE conversation_id = %s
        ORDER BY created_at ASC
        LIMIT %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (conversation_id, limit))
                rows = await cur.fetchall()
                return [
                    MessageModel(
                        id=r[0],
                        conversation_id=r[1],
                        sender=r[2],
                        content=r[3],
                        message_type=r[4],
                        tool_calls=r[5] if isinstance(r[5], list) else json.loads(r[5] or "[]"),
                        created_at=r[6],
                        metadata=r[7] if isinstance(r[7], dict) else json.loads(r[7] or "{}"),
                    )
                    for r in rows
                ]

    # ==========================================
    # TASKS & APPROVALS
    # ==========================================

    async def create_task(self, task: TaskModel) -> TaskModel:
        if not await self._ensure_connected():
            return task
        sql = """
        INSERT INTO synckre.tasks
            (id, conversation_id, type, goal, status, priority, context, result,
             approval_required, approval_status, temporal_workflow_id, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            result = EXCLUDED.result,
            approval_status = EXCLUDED.approval_status,
            temporal_workflow_id = EXCLUDED.temporal_workflow_id,
            updated_at = EXCLUDED.updated_at;
        """
        async with self.pool.connection() as conn:
            await conn.execute(
                sql,
                (
                    task.id,
                    task.conversation_id,
                    task.type,
                    task.goal,
                    task.status.value if hasattr(task.status, "value") else str(task.status),
                    task.priority,
                    json.dumps(task.context),
                    json.dumps(task.result) if task.result else None,
                    task.approval_required,
                    task.approval_status.value if task.approval_status and hasattr(task.approval_status, "value") else (task.approval_status or None),
                    task.temporal_workflow_id,
                    task.created_at,
                    task.updated_at,
                ),
            )
        return task

    async def get_task(self, task_id: str) -> Optional[TaskModel]:
        if not await self._ensure_connected():
            return None
        sql = """
        SELECT id, conversation_id, type, goal, status, priority, context, result,
               approval_required, approval_status, temporal_workflow_id, created_at, updated_at
        FROM synckre.tasks
        WHERE id = %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (task_id,))
                row = await cur.fetchone()
                if not row:
                    return None
                return TaskModel(
                    id=row[0],
                    conversation_id=row[1],
                    type=row[2],
                    goal=row[3],
                    status=TaskStatus(row[4]),
                    priority=row[5],
                    context=row[6] if isinstance(row[6], dict) else json.loads(row[6] or "{}"),
                    result=row[7] if isinstance(row[7], dict) else (json.loads(row[7]) if row[7] else None),
                    approval_required=row[8],
                    approval_status=ApprovalStatus(row[9]) if row[9] else None,
                    temporal_workflow_id=row[10],
                    created_at=row[11],
                    updated_at=row[12],
                )

    async def list_tasks(
        self,
        limit: int = 50,
        conversation_id: Optional[str] = None,
    ) -> List[TaskModel]:
        if not await self._ensure_connected():
            return []
        sql = """
        SELECT id, conversation_id, type, goal, status, priority, context, result,
               approval_required, approval_status, temporal_workflow_id, created_at, updated_at
        FROM synckre.tasks
        """
        params: Tuple = ()
        if conversation_id:
            sql += "WHERE conversation_id = %s "
            params = (conversation_id,)
        sql += "ORDER BY updated_at DESC LIMIT %s;"
        params = (*params, limit)
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()
                return [
                    TaskModel(
                        id=r[0],
                        conversation_id=r[1],
                        type=r[2],
                        goal=r[3],
                        status=TaskStatus(r[4]),
                        priority=r[5],
                        context=r[6] if isinstance(r[6], dict) else json.loads(r[6] or "{}"),
                        result=r[7] if isinstance(r[7], dict) else (json.loads(r[7]) if r[7] else None),
                        approval_required=r[8],
                        approval_status=ApprovalStatus(r[9]) if r[9] else None,
                        temporal_workflow_id=r[10],
                        created_at=r[11],
                        updated_at=r[12],
                    )
                    for r in rows
                ]

    async def create_approval(self, approval: ApprovalModel) -> ApprovalModel:
        if not await self._ensure_connected():
            return approval
        sql = """
        INSERT INTO synckre.approvals
            (id, task_id, target_type, target_id, action, status, requested_by, approved_by,
             previous_value, new_value, reason, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """
        async with self.pool.connection() as conn:
            await conn.execute(
                sql,
                (
                    approval.id,
                    approval.task_id,
                    approval.target_type,
                    approval.target_id,
                    approval.action,
                    approval.status.value if hasattr(approval.status, "value") else str(approval.status),
                    approval.requested_by,
                    approval.approved_by,
                    approval.previous_value,
                    approval.new_value,
                    approval.reason,
                    approval.created_at,
                    approval.updated_at,
                ),
            )
        return approval

    async def list_approvals(self, status: Optional[str] = None, limit: int = 50) -> List[ApprovalModel]:
        if not await self._ensure_connected():
            return []
        if status:
            sql = """
            SELECT id, task_id, target_type, target_id, action, status, requested_by, approved_by,
                   previous_value, new_value, reason, created_at, updated_at
            FROM synckre.approvals
            WHERE status = %s
            ORDER BY created_at DESC
            LIMIT %s;
            """
            params = (status, limit)
        else:
            sql = """
            SELECT id, task_id, target_type, target_id, action, status, requested_by, approved_by,
                   previous_value, new_value, reason, created_at, updated_at
            FROM synckre.approvals
            ORDER BY created_at DESC
            LIMIT %s;
            """
            params = (limit,)

        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()
                return [
                    ApprovalModel(
                        id=r[0],
                        task_id=r[1],
                        target_type=r[2],
                        target_id=r[3],
                        action=r[4],
                        status=ApprovalStatus(r[5]),
                        requested_by=r[6],
                        approved_by=r[7],
                        previous_value=r[8],
                        new_value=r[9],
                        reason=r[10],
                        created_at=r[11],
                        updated_at=r[12],
                    )
                    for r in rows
                ]

    async def update_approval(
        self,
        approval_id: str,
        status: ApprovalStatus,
        approved_by: str,
        reason: Optional[str] = None,
        new_value: Optional[str] = None,
    ) -> bool:
        if not await self._ensure_connected():
            return False
        sql = """
        UPDATE synckre.approvals
        SET status = %s, approved_by = %s, reason = %s, new_value = COALESCE(%s, new_value), updated_at = %s
        WHERE id = %s;
        """
        now = datetime.utcnow()
        async with self.pool.connection() as conn:
            await conn.execute(sql, (status.value, approved_by, reason, new_value, now, approval_id))
        return True

    # ==========================================
    # AUDIT LOGS
    # ==========================================

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
    ):
        if not await self._ensure_connected():
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
            logger.error(f"Error guardando audit log: {e}")

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
    ):
        if not await self._ensure_connected():
            return
        sql = """
        INSERT INTO synckre.tool_executions
            (id, task_id, conversation_id, tool_name, input_data, output_data, status, execution_time_ms)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
        """
        tool_id = f"TEX-{uuid.uuid4().hex[:8]}"
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    sql,
                    (
                        tool_id,
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
            logger.error(f"Error guardando tool execution: {e}")

    async def list_tool_executions(
        self,
        conversation_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Devuelve la telemetría detallada de ejecuciones de herramientas (input/output JSON completos)."""
        if not await self._ensure_connected():
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

    # ==========================================
    # LEADS (registrados en synckre.memory con entity_type='lead')
    # ==========================================

    async def guardar_lead(
        self,
        *,
        nombre: str,
        email: str,
        empresa: str = "",
        telefono: str = "",
        mensaje: str = "",
        origen: str = "web",
        workflow_id: str = "",
        erp_id: str = "",
        erp_destino: str = "local",
    ) -> Optional[int]:
        """Persiste un lead en synckre.memory (entity_type='lead'); devuelve el id local.

        Cada registro es una fila nueva (pipeline: pueden existir varios leads del mismo email).
        Los campos de pipeline (workflow, ERP, origen, status) van en la columna metadata.
        """
        if not await self._ensure_connected():
            return None
        metadata = {
            "workflow_id": workflow_id,
            "origen": origen,
            "erp_id": erp_id,
            "erp_destino": erp_destino,
            "status": "new",
        }
        sql = """
        INSERT INTO synckre.memory
            (entity_type, email, role_name, name, company, phone, summary, metadata, last_interaction, updated_at)
        VALUES ('lead', %s, 'customer_support', %s, %s, %s, %s, %s, %s, %s)
        RETURNING id;
        """
        try:
            async with self.pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        sql,
                        (email, nombre, empresa, telefono, mensaje,
                         json.dumps(metadata), datetime.utcnow(), datetime.utcnow()),
                    )
                    row = await cur.fetchone()
                    return int(row[0]) if row else None
        except Exception as exc:
            logger.error(f"Error guardando lead: {exc}")
            return None

    async def list_leads(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Lista los leads registrados en synckre.memory (entity_type='lead')."""
        if not await self._ensure_connected():
            return []
        sql = """
        SELECT id, email, name, company, phone, summary, metadata, created_at
        FROM synckre.memory
        WHERE entity_type = 'lead'
        ORDER BY created_at DESC
        LIMIT %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (limit,))
                rows = await cur.fetchall()
                result = []
                for r in rows:
                    meta = r[6] if isinstance(r[6], dict) else json.loads(r[6] or "{}")
                    result.append({
                        "id": r[0],
                        "workflow_id": meta.get("workflow_id"),
                        "nombre": r[2],
                        "email": r[1],
                        "empresa": r[3] or "",
                        "telefono": r[4] or "",
                        "mensaje": r[5] or "",
                        "origen": meta.get("origen", "web"),
                        "erp_id": meta.get("erp_id"),
                        "erp_destino": meta.get("erp_destino", "local"),
                        "status": meta.get("status", "new"),
                        "created_at": r[7].isoformat() if r[7] else None,
                    })
                return result

    # ==========================================
    # CONTRACTS
    # ==========================================

    async def create_contract(self, contract: ContractModel) -> ContractModel:
        if not await self._ensure_connected():
            return contract
        sql = """
        INSERT INTO synckre.contracts
            (id, customer_id, title, status, template_name, content, created_by, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            status = EXCLUDED.status,
            template_name = EXCLUDED.template_name,
            content = EXCLUDED.content,
            updated_at = EXCLUDED.updated_at;
        """
        async with self.pool.connection() as conn:
            await conn.execute(
                sql,
                (
                    contract.id,
                    contract.customer_id,
                    contract.title,
                    contract.status.value if hasattr(contract.status, "value") else str(contract.status),
                    contract.template_name,
                    contract.content,
                    contract.created_by,
                    contract.created_at,
                    contract.updated_at,
                ),
            )
        return contract

    async def update_contract_status(self, contract_id: str, status: str, updated_by: str) -> bool:
        if not await self._ensure_connected():
            return False
        sql = """
        UPDATE synckre.contracts
        SET status = %s, updated_at = %s
        WHERE id = %s;
        """
        try:
            async with self.pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(sql, (status, datetime.utcnow(), contract_id))
                    return (cur.rowcount or 0) > 0
        except Exception as exc:
            logger.error(f"Error actualizando contrato {contract_id}: {exc}")
            return False

    async def get_contract(self, contract_id: str) -> Optional[ContractModel]:
        if not await self._ensure_connected():
            return None
        sql = """
        SELECT id, customer_id, title, status, template_name, content, created_by, created_at, updated_at
        FROM synckre.contracts
        WHERE id = %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (contract_id,))
                row = await cur.fetchone()
                if not row:
                    return None
                return ContractModel(
                    id=row[0],
                    customer_id=row[1],
                    title=row[2],
                    status=row[3],
                    template_name=row[4],
                    content=row[5],
                    created_by=row[6],
                    created_at=row[7],
                    updated_at=row[8],
                )

    # ==========================================
    # MEMORY (perfil persistente por entidad y rol)
    # ==========================================

    async def upsert_memory(
        self,
        *,
        email: str,
        role_name: str,
        entity_type: str = "customer",
        entity_id: str = "",
        name: str = "",
        company: str = "",
        phone: str = "",
        summary: str = "",
        preferences: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Actualiza/crea el perfil de memoria de una entidad (por defecto un cliente).

        Para entity_type='customer' aplica upsert por (email, role_name): un perfil por rol.
        Para otras entidades (p.ej. 'lead') usa INSERT simple, creando una fila nueva.
        """
        if not await self._ensure_connected() or not email:
            return False
        now = datetime.utcnow()
        if entity_type == "customer":
            sql = """
            INSERT INTO synckre.memory
                (entity_type, entity_id, email, role_name, name, company, phone,
                 preferences, summary, metadata, last_interaction, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (email, role_name) WHERE entity_type = 'customer' DO UPDATE SET
                entity_id = COALESCE(NULLIF(EXCLUDED.entity_id, ''), synckre.memory.entity_id),
                name = COALESCE(NULLIF(EXCLUDED.name, ''), synckre.memory.name),
                company = COALESCE(NULLIF(EXCLUDED.company, ''), synckre.memory.company),
                phone = COALESCE(NULLIF(EXCLUDED.phone, ''), synckre.memory.phone),
                preferences = synckre.memory.preferences || EXCLUDED.preferences,
                summary = COALESCE(EXCLUDED.summary, synckre.memory.summary),
                metadata = synckre.memory.metadata || EXCLUDED.metadata,
                last_interaction = EXCLUDED.last_interaction,
                updated_at = EXCLUDED.updated_at;
            """
            params = (
                entity_type, entity_id, email, role_name, name, company, phone,
                json.dumps(preferences or {}), summary, json.dumps(metadata or {}),
                now, now, now,
            )
        else:
            sql = """
            INSERT INTO synckre.memory
                (entity_type, entity_id, email, role_name, name, company, phone,
                 preferences, summary, metadata, last_interaction, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
            """
            params = (
                entity_type, entity_id, email, role_name, name, company, phone,
                json.dumps(preferences or {}), summary, json.dumps(metadata or {}),
                now, now, now,
            )
        try:
            async with self.pool.connection() as conn:
                await conn.execute(sql, params)
            return True
        except Exception as exc:
            logger.error(f"Error guardando memoria de {entity_type} {email} ({role_name}): {exc}")
            return False

    async def get_memory(
        self,
        email: str,
        role_name: str,
        entity_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Perfil de memoria de una entidad.

        Si entity_type se omite, busca primero el perfil de cliente (entity_type='customer',
        aislado por rol) y, si no existe, el del lead (entity_type='lead', sin
        restricción de rol): así un lead registrado vía web form también es recordado.
        """
        if not await self._ensure_connected() or not email:
            return None
        if entity_type:
            sql = """
            SELECT entity_type, entity_id, email, role_name, name, company, phone,
                   preferences, summary, metadata, last_interaction
            FROM synckre.memory
            WHERE email = %s AND role_name = %s AND entity_type = %s;
            """
            params = (email, role_name, entity_type)
        else:
            sql = """
            SELECT entity_type, entity_id, email, role_name, name, company, phone,
                   preferences, summary, metadata, last_interaction
            FROM synckre.memory
            WHERE (email = %s AND role_name = %s AND entity_type = 'customer')
               OR (email = %s AND entity_type = 'lead')
            ORDER BY (entity_type = 'customer') DESC, updated_at DESC
            LIMIT 1;
            """
            params = (email, role_name, email)
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                row = await cur.fetchone()
                if not row:
                    return None
                return {
                    "entity_type": row[0],
                    "entity_id": row[1],
                    "email": row[2],
                    "role_name": row[3],
                    "name": row[4],
                    "company": row[5],
                    "phone": row[6],
                    "preferences": row[7] if isinstance(row[7], dict) else json.loads(row[7] or "{}"),
                    "summary": row[8],
                    "metadata": row[9] if isinstance(row[9], dict) else json.loads(row[9] or "{}"),
                    "last_interaction": row[10].isoformat() if row[10] else None,
                }

    async def list_audit_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        if not await self._ensure_connected():
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

    # ==========================================
    # APPOINTMENT REMINDERS (emails automáticos)
    # ==========================================

    async def create_appointment_reminder(
        self,
        *,
        event_id: str,
        conversation_id: Optional[str],
        client_name: str,
        client_email: str,
        appointment_at: datetime,
        reminder_type: str,
        scheduled_for: datetime,
        motivo: str = "",
    ) -> bool:
        if not await self._ensure_connected():
            return False
        sql = """
        INSERT INTO synckre.appointment_reminders
            (event_id, conversation_id, client_name, client_email, appointment_at, reminder_type, scheduled_for, motivo)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
        """
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    sql,
                    (event_id, conversation_id, client_name, client_email, appointment_at, reminder_type, scheduled_for, motivo),
                )
            return True
        except Exception as exc:
            logger.error(f"Error guardando recordatorio: {exc}")
            return False

    async def list_due_reminders(
        self,
        now: datetime,
        limit: int = 50,
        conn=None,
    ) -> List[Dict[str, Any]]:
        """Recordatorios vencidos no enviados.

        Si se pasa `conn` (conexión externa, p.ej. dentro de una transacción del
        scheduler), usa FOR UPDATE SKIP LOCKED para reclamar las filas sin
        duplicar envíos entre instancias/poll solapados.
        """
        if not await self._ensure_connected():
            return []
        lock_clause = "FOR UPDATE SKIP LOCKED" if conn is not None else ""
        sql = f"""
        SELECT id, event_id, conversation_id, client_name, client_email,
               appointment_at, reminder_type, scheduled_for, motivo
        FROM synckre.appointment_reminders
        WHERE scheduled_for <= %s AND sent_at IS NULL
        ORDER BY scheduled_for ASC
        LIMIT %s
        {lock_clause};
        """
        if conn is not None:
            async with conn.cursor() as cur:
                await cur.execute(sql, (now, limit))
                rows = await cur.fetchall()
        else:
            async with self.pool.connection() as conn_own:
                async with conn_own.cursor() as cur:
                    await cur.execute(sql, (now, limit))
                    rows = await cur.fetchall()
        return [
            {
                "id": r[0],
                "event_id": r[1],
                "conversation_id": r[2],
                "client_name": r[3],
                "client_email": r[4],
                "appointment_at": r[5].isoformat() if r[5] else None,
                "reminder_type": r[6],
                "scheduled_for": r[7].isoformat() if r[7] else None,
                "motivo": r[8],
            }
            for r in rows
        ]

    async def mark_reminder_sent(
        self,
        reminder_id: int,
        error: Optional[str] = None,
        conn=None,
    ) -> bool:
        """Marca un recordatorio.

        Sin error -> fija sent_at (enviado, no se reintenta).
        Con error  -> solo guarda el error y DEJA sent_at en NULL (se reintenta
        en el siguiente ciclo del scheduler).
        Si se pasa `conn`, la actualización ocurre dentro de esa transacción.
        """
        if not await self._ensure_connected():
            return False
        if error:
            sql = "UPDATE synckre.appointment_reminders SET error = %s WHERE id = %s AND sent_at IS NULL;"
            params = (error[:500], reminder_id)
        else:
            sql = "UPDATE synckre.appointment_reminders SET sent_at = %s, error = NULL WHERE id = %s AND sent_at IS NULL;"
            params = (datetime.utcnow(), reminder_id)
        try:
            if conn is not None:
                await conn.execute(sql, params)
            else:
                async with self.pool.connection() as conn_own:
                    await conn_own.execute(sql, params)
            return True
        except Exception as exc:
            logger.error(f"Error marcando recordatorio {reminder_id}: {exc}")
            return False

    async def delete_reminders(self, event_id: str) -> bool:
        """Elimina los recordatorios programados de un evento (p.ej. al cancelar/reagendar)."""
        if not await self._ensure_connected() or not event_id:
            return False
        try:
            async with self.pool.connection() as conn:
                await conn.execute(
                    "DELETE FROM synckre.appointment_reminders WHERE event_id = %s;",
                    (event_id,),
                )
            return True
        except Exception as exc:
            logger.error(f"Error eliminando recordatorios de {event_id}: {exc}")
            return False

    async def get_reminders_for_event(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Datos del cliente/motivo de un evento a partir de sus recordatorios (para reagendar)."""
        if not await self._ensure_connected() or not event_id:
            return None
        sql = """
        SELECT client_name, client_email, appointment_at, motivo
        FROM synckre.appointment_reminders
        WHERE event_id = %s
        ORDER BY scheduled_for ASC
        LIMIT 1;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (event_id,))
                row = await cur.fetchone()
                if not row:
                    return None
                return {
                    "client_name": row[0],
                    "client_email": row[1],
                    "appointment_at": row[2].isoformat() if row[2] else None,
                    "motivo": row[3],
                }

    async def get_next_event_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Próxima cita futura de un cliente por email (a partir de sus recordatorios).

        Permite reagendar/cancelar sin que el usuario recuerde la referencia del evento.
        """
        if not await self._ensure_connected() or not email:
            return None
        sql = """
        SELECT event_id, client_name, client_email, appointment_at, motivo
        FROM synckre.appointment_reminders
        WHERE client_email = %s AND appointment_at >= NOW()
        ORDER BY appointment_at ASC
        LIMIT 1;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (email,))
                row = await cur.fetchone()
                if not row:
                    return None
                return {
                    "event_id": row[0],
                    "client_name": row[1],
                    "client_email": row[2],
                    "appointment_at": row[3].isoformat() if row[3] else None,
                    "motivo": row[4],
                }

    async def list_upcoming_appointments(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Próximas citas agendadas (para el control de agenda local)."""
        if not await self._ensure_connected():
            return []
        sql = """
        SELECT DISTINCT ON (event_id) event_id, client_name, client_email, appointment_at, reminder_type
        FROM synckre.appointment_reminders
        WHERE appointment_at >= NOW()
        ORDER BY event_id, appointment_at ASC
        LIMIT %s;
        """
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (limit,))
                rows = await cur.fetchall()
                return [
                    {
                        "event_id": r[0],
                        "client_name": r[1],
                        "client_email": r[2],
                        "appointment_at": r[3].isoformat() if r[3] else None,
                        "reminder_type": r[4],
                    }
                    for r in rows
                ]

    # ==========================================
    # VECTOR RAG SEARCH
    # ==========================================

    async def search_similar_chunks(
        self,
        domain: str,
        query_embedding: List[float],
        top_k: int = 4,
    ) -> List[Dict[str, Any]]:
        if not await self._ensure_connected():
            return []
        try:
            embedding_str = f"[{','.join(map(str, query_embedding))}]"
            sql = """
            SELECT filename, chunk_index, content, (1 - (embedding <=> %s::vector)) AS similarity
            FROM synckre.document_chunks
            WHERE domain = %s
            ORDER BY embedding <=> %s::vector ASC
            LIMIT %s;
            """
            async with self.pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(sql, (embedding_str, domain, embedding_str, top_k))
                    rows = await cur.fetchall()
                    return [
                        {
                            "filename": row[0],
                            "chunk_index": row[1],
                            "content": row[2],
                            "similarity": float(row[3]) if row[3] is not None else 0.0,
                        }
                        for row in rows
                    ]
        except Exception as e:
            logger.error(f"Error en búsqueda RAG domain='{domain}': {e}")
            return []


    async def get_analytics_stats(self) -> Dict[str, int]:
        if not await self._ensure_connected():
            return {"erp_mutations": 0, "calendar_bookings": 0, "emails_sent": 0, "rag_queries": 0}
        
        sql = """
        SELECT 
            COALESCE(SUM(CASE WHEN tool_name IN ('create_lead', 'create_customer', 'update_customer') THEN 1 ELSE 0 END), 0) as erp,
            COALESCE(SUM(CASE WHEN tool_name IN ('create_event', 'reschedule_event') THEN 1 ELSE 0 END), 0) as calendar,
            COALESCE(SUM(CASE WHEN tool_name = 'send_email' THEN 1 ELSE 0 END), 0) as email,
            COALESCE(SUM(CASE WHEN tool_name IN ('read_public_knowledge', 'read_internal_knowledge', 'search_documents') THEN 1 ELSE 0 END), 0) as rag
        FROM synckre.tool_executions;
        """
        try:
            async with self.pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(sql)
                    row = await cur.fetchone()
                    if row:
                        return {
                            "erp_mutations": int(row[0]),
                            "calendar_bookings": int(row[1]),
                            "emails_sent": int(row[2]),
                            "rag_queries": int(row[3])
                        }
        except Exception as e:
            logger.error(f"Error cargando estadísticas de telemetría: {e}")
        return {"erp_mutations": 0, "calendar_bookings": 0, "emails_sent": 0, "rag_queries": 0}


db_manager = DatabaseManager()
