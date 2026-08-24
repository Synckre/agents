"""
AgentRuntime — El núcleo del runtime conversacional y de tareas de Synckre Agent V2.

Arquitectura:
User -> API -> Conversation -> AgentRuntime -> AgentPort (Pydantic AI) -> Role+Policy -> Memory+RAG -> ToolRegistry -> Task/jobs

Soporta el Agent Execution Loop con límites configurables (max_iterations, max_tool_calls, timeout).
"""

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.application.agent.heuristic import heuristic_plan
from app.application.agent.memory import MemoryRetriever
from app.application.agent.policies import PolicyEngine, GuardrailsEngine
from app.application.agent.ports import AgentPort, AgentUnavailable, LlmPort, LlmResult, TurnInput
from app.application.agent.prepare_args import prepare_tool_args
from app.application.agent.prompts import build_system_prompt
from app.application.agent.roles import RoleModel, RoleSystem
from app.application.agent.text import limpiar_texto_final
from app.application.agent.tools_registry import tool_registry
from app.application.services.event_bus import event_bus
from app.application.services.memory_service import memory_service
from app.infrastructure.config import settings
from app.infrastructure.db.manager import db_manager
from app.domain import (
    ApprovalModel,
    ApprovalStatus,
    ChannelEnum,
    ConversationModel,
    MessageModel,
    TaskModel,
    TaskStatus,
)

logger = logging.getLogger("agent_runtime")


_pending_telemetry: set[asyncio.Task] = set()


def _spawn_telemetry(coro) -> None:
    """Persiste métricas fuera del camino de la respuesta al usuario."""
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        return
    _pending_telemetry.add(task)
    task.add_done_callback(_pending_telemetry.discard)


async def _flush_run_telemetry(stats: "_RunStats") -> None:
    try:
        await db_manager.persist_run_telemetry(
            run_id=stats.run_id,
            conversation_id=stats.conversation_id,
            role=stats.role,
            channel=stats.channel,
            outcome=stats.outcome,
            llm_calls=stats.llm_calls,
            llm_failures=stats.llm_failures,
            llm_latency_ms=stats.llm_latency_ms,
            used_fallback=stats.used_fallback,
            tool_calls=stats.tool_calls,
            used_rag=stats.used_rag,
            rag_chunks=stats.rag_chunks,
            policy_denied=stats.policy_denied,
            duration_ms=stats.duration_ms,
            prompt_tokens=stats.prompt_tokens,
            completion_tokens=stats.completion_tokens,
            llm_events=stats.llm_events,
        )
    except Exception:
        logger.exception("Telemetría en segundo plano falló")


@dataclass
class _RunStats:
    """Telemetría técnica de una pasada. Sin texto de usuario ni respuestas."""

    run_id: str
    conversation_id: str
    role: str
    channel: str = "api"
    outcome: str = "success"
    llm_calls: int = 0
    llm_failures: int = 0
    llm_latency_ms: int = 0
    used_fallback: bool = False
    tool_calls: int = 0
    used_rag: bool = False
    rag_chunks: int = 0
    policy_denied: bool = False
    duration_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    llm_events: list = field(default_factory=list)

    def note_llm(
        self,
        *,
        status: str,
        latency_ms: int,
        prompt: int = 0,
        completion: int = 0,
        phase: str = "plan",
        http_status: Optional[int] = None,
        attempt: int = 1,
    ) -> None:
        self.llm_calls += 1
        self.llm_latency_ms += max(latency_ms, 0)
        self.prompt_tokens += max(prompt, 0)
        self.completion_tokens += max(completion, 0)
        if status in ("error", "http_error", "timeout"):
            self.llm_failures += 1
        if status == "fallback":
            self.used_fallback = True
        self.llm_events.append(
            {
                "phase": phase,
                "status": status,
                "latency_ms": latency_ms,
                "prompt_tokens": prompt,
                "completion_tokens": completion,
                "http_status": http_status,
                "attempt": attempt,
            }
        )


# Tools cuya respuesta ya es un mensaje listo para el usuario: no requieren la
# segunda llamada al LLM para integrar el resultado -> se evita ~50% de latencia.
_SIMPLE_CONFIRM_TOOLS = {
    "create_lead",
    "update_lead",
    "add_lead_note",
    "create_customer",
    "update_customer",
    "create_ticket",
    "update_ticket",
    "cancel_event",
    "transfer_to_agent",
    "update_issue",
    "send_email",
    "escalate_ticket",
    "request_information",
    "generate_document",
}





class AgentRuntimeResult:
    def __init__(
        self,
        response_text: str,
        conversation_id: str,
        role: str,
        tool_calls: Optional[List[Dict[str, Any]]] = None,
        task_created: Optional[Dict[str, Any]] = None,
        requires_human_approval: bool = False,
    ):
        self.response_text = response_text
        self.conversation_id = conversation_id
        self.role = role
        self.tool_calls = tool_calls or []
        self.task_created = task_created
        self.requires_human_approval = requires_human_approval

    def to_dict(self) -> Dict[str, Any]:
        return {
            "response": self.response_text,
            "conversation_id": self.conversation_id,
            "role": self.role,
            "tool_calls": self.tool_calls,
            "task": self.task_created,
            "requires_human_approval": self.requires_human_approval,
        }


class AgentRuntime:
    def __init__(
        self,
        max_iterations: int = 5,
        max_tool_calls: int = 3,
        llm: Optional[LlmPort] = None,
        agent_port: Optional[AgentPort] = None,
    ):
        self.max_iterations = max_iterations
        self.max_tool_calls = max_tool_calls
        self._llm = llm
        self._agent_port = agent_port

    @property
    def llm(self) -> LlmPort:
        if self._llm is None:
            from app.infrastructure.llm.deepseek import DeepseekLlm

            self._llm = DeepseekLlm()
        return self._llm

    @property
    def agent_port(self) -> AgentPort:
        if self._agent_port is None:
            from app.application.services.job_scheduler import job_scheduler
            from app.infrastructure.agent.pydantic_runtime import PydanticAgentRuntime

            self._agent_port = PydanticAgentRuntime(
                execute_tool=tool_registry.execute_tool,
                enqueue_job=job_scheduler.enqueue,
            )
        return self._agent_port

    def _should_use_pydantic(self) -> bool:
        if self._agent_port is not None:
            return True
        if self._llm is not None:
            return False
        return settings.use_pydantic_runtime

    async def execute(
        self,
        conversation_id: str,
        user_input: str,
        role_name: str = "customer_support",
        channel: str = "api",
        user_id: Optional[str] = None,
        customer_id: Optional[str] = None,
    ) -> AgentRuntimeResult:
        started = time.perf_counter()
        stats = _RunStats(
            run_id=f"RUN-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            role=role_name,
            channel=channel or "api",
        )
        try:
            return await self._run_turn(
                conversation_id=conversation_id,
                user_input=user_input,
                role_name=role_name,
                channel=channel,
                user_id=user_id,
                customer_id=customer_id,
                stats=stats,
            )
        except Exception:
            stats.outcome = "error"
            raise
        finally:
            stats.duration_ms = int((time.perf_counter() - started) * 1000)
            _spawn_telemetry(_flush_run_telemetry(stats))

    async def _run_turn(
        self,
        conversation_id: str,
        user_input: str,
        role_name: str,
        channel: str,
        user_id: Optional[str],
        customer_id: Optional[str],
        stats: _RunStats,
    ) -> AgentRuntimeResult:
        """
        Ejecuta el ciclo principal del Agent Runtime V2.
        """
        # 1. Cargar o Crear Conversación
        conversation = await db_manager.get_conversation(conversation_id)
        if not conversation:
            conversation = ConversationModel(
                id=conversation_id,
                channel=ChannelEnum(channel) if channel in ChannelEnum.__members__ else ChannelEnum.API,
                user_id=user_id,
                customer_id=customer_id,
                role=role_name,
            )
            await db_manager.create_conversation(conversation)

        # 2. Registrar Mensaje de Usuario
        user_msg = MessageModel(
            id=f"MSG-{uuid.uuid4().hex[:8]}",
            conversation_id=conversation_id,
            sender="user",
            content=user_input,
        )
        await db_manager.add_message(user_msg)

        # 2a. Guardrails: detectar inyección de prompt
        is_injection, guard_msg = GuardrailsEngine.detect_prompt_injection(user_input)
        if is_injection:
            logger.warning(f"Guardrails interceptó inyección de prompt en conv {conversation_id}: {guard_msg}")
            stats.outcome = "guardrail_block"
            bot_msg = MessageModel(
                id=f"MSG-{uuid.uuid4().hex[:8]}",
                conversation_id=conversation_id,
                sender="assistant",
                content="Disculpa, tu mensaje contiene instrucciones no permitidas y ha sido bloqueado por razones de seguridad.",
            )
            await db_manager.add_message(bot_msg)
            return AgentRuntimeResult(
                response_text=bot_msg.content,
                conversation_id=conversation_id,
                role=role_name,
            )

        # 2b. Memoria: extraer y persistir datos del cliente de este mensaje (aislada por rol)
        await memory_service.ingest_message(conversation_id, role_name, user_input)

        # 3. Determinar Rol y Políticas
        role: RoleModel = RoleSystem.get_role(role_name)

        # 4. Recuperar Memoria y Contexto
        context = await MemoryRetriever.get_context(
            conversation_id=conversation_id,
            role_name=role.name,
            allowed_knowledge_sources=role.allowed_knowledge_sources,
            user_query=user_input,
        )

        # 5. Obtener Herramientas Autorizadas
        all_registered = tool_registry.list_tools()
        authorized_tools = PolicyEngine.filter_authorized_tools(role, all_registered)

        if self._should_use_pydantic():
            try:
                return await self._run_with_port(
                    conversation_id=conversation_id,
                    user_input=user_input,
                    role=role,
                    channel=channel,
                    user_id=user_id,
                    customer_id=customer_id,
                    context=context,
                    authorized_tools=authorized_tools,
                    all_registered=all_registered,
                    stats=stats,
                )
            except AgentUnavailable as exc:
                logger.warning("AgentPort no disponible (%s); se usa el runtime legacy", exc)
                if not settings.allow_heuristic_fallback:
                    stats.outcome = "llm_fallback"
                    return await self._finalize_turn(
                        conversation_id=conversation_id,
                        role_name=role.name,
                        user_id=user_id,
                        stats=stats,
                        final_answer=(
                            "No pude completar la respuesta en este momento. "
                            "Inténtalo de nuevo en unos minutos."
                        ),
                        executed_tool_calls=[],
                        created_task_dict=None,
                        requires_approval=False,
                        context=context,
                    )

        # 6. Agent Loop (UNDERSTAND -> PLAN -> TOOL? -> OBSERVE -> TASK NEEDED? -> RESPOND)
        executed_tool_calls = []
        created_task_dict = None
        requires_approval = False

        # Intentar llamada con LLM / DeepSeek
        llm_response = await self._call_deepseek_llm(
            role=role,
            user_input=user_input,
            context=context,
            tools=authorized_tools,
            conversation_id=conversation_id,
            stats=stats,
            phase="plan",
        )

        # Evaluar si el modelo sugirió invocar una herramienta o crear una tarea
        selected_tool_name = llm_response.get("tool_to_call")
        tool_args = llm_response.get("tool_args", {})
        final_answer = llm_response.get("answer", "")
        transfer_target: Optional[str] = None  # rol al que se transfiere la conversación

        if selected_tool_name and not PolicyEngine.is_tool_allowed(role, selected_tool_name):
            stats.policy_denied = True
            selected_tool_name = None

        if selected_tool_name and PolicyEngine.is_tool_allowed(role, selected_tool_name):
            tool_def = tool_registry.get_tool(selected_tool_name)
            if tool_def:
                # Verificar si requiere aprobación humana por Nivel 3 o Policy
                needs_approval = PolicyEngine.requires_human_approval(role, selected_tool_name, tool_def.risk_level)

                if needs_approval or tool_def.requires_approval:
                    requires_approval = True
                    stats.outcome = "hitl"
                    # Crear Tarea en estado WAITING_HUMAN
                    task = TaskModel(
                        id=f"TSK-{uuid.uuid4().hex[:8]}",
                        conversation_id=conversation_id,
                        type="human_approval",
                        goal=f"Ejecución sensible de tool '{selected_tool_name}'",
                        status=TaskStatus.WAITING_HUMAN,
                        approval_required=True,
                        approval_status=ApprovalStatus.PENDING,
                        context={"tool_name": selected_tool_name, "tool_args": tool_args},
                    )
                    await db_manager.create_task(task)

                    approval = ApprovalModel(
                        id=f"APP-{uuid.uuid4().hex[:8]}",
                        task_id=task.id,
                        target_type="tool_execution",
                        action=selected_tool_name,
                        status=ApprovalStatus.PENDING,
                        previous_value=None,
                        new_value=json.dumps(tool_args),
                        reason=f"La herramienta '{selected_tool_name}' requiere aprobación humana.",
                    )
                    await db_manager.create_approval(approval)
                    created_task_dict = task.dict()

                    final_answer = (
                        f"La operación '{selected_tool_name}' requiere aprobación previa por parte de un supervisor humano. "
                        f"Se ha registrado la Tarea ID: {task.id} en cola de revisión."
                    )
                    executed_tool_calls.append({"tool": selected_tool_name, "status": "waiting_human", "task_id": task.id})
                else:
                    # Ejecutar Tool automáticamente (Level 1 o Safe Action Level 2)
                    await event_bus.publish(
                        conversation_id, {"type": "tool_started", "tool": selected_tool_name}
                    )
                    start_t = time.time()
                    exec_args = await prepare_tool_args(
                        selected_tool_name,
                        dict(tool_args),
                        conversation_id=conversation_id,
                        user_input=user_input,
                    )

                    try:
                        tool_result = await tool_registry.execute_tool(selected_tool_name, **exec_args)
                    except Exception as tool_exc:
                        logger.warning(f"Self-Correction: Excepción al ejecutar tool {selected_tool_name}: {tool_exc}")
                        tool_result = {"status": "error", "error": str(tool_exc)}

                    latency = int((time.time() - start_t) * 1000)

                    # Traspaso entre agentes públicos: transfer_to_agent actualiza el rol
                    # de la conversación para que los siguientes mensajes los atienda el
                    # nuevo agente (y se devuelve el rol nuevo al frontend).
                    if isinstance(tool_result, dict) and tool_result.get("transfer_to"):
                        transfer_target = tool_result["transfer_to"]
                        if transfer_target and transfer_target != role.name:
                            await db_manager.update_conversation_role(conversation_id, transfer_target)

                    await event_bus.publish(
                        conversation_id,
                        {
                            "type": "tool_completed",
                            "tool": selected_tool_name,
                            "status": tool_result.get("status", "success") if isinstance(tool_result, dict) else "success",
                        },
                    )
                    executed_tool_calls.append({"tool": selected_tool_name, "result": tool_result})
                    stats.tool_calls += 1

                    # Registrar la ejecución física de la herramienta en la base de datos para analíticas
                    await db_manager.log_tool_execution(
                        conversation_id=conversation_id,
                        tool_name=selected_tool_name,
                        input_data=tool_args,
                        output_data=tool_result,
                        status=tool_result.get("status", "success"),
                        execution_time_ms=latency,
                    )

                    # Memoria (aislada por rol): persistir datos estructurados de tools
                    await memory_service.record_from_tool(
                        conversation_id=conversation_id,
                        role_name=role.name,
                        tool_name=selected_tool_name,
                        tool_args=tool_args,
                    )

                    # Registrar evento de auditoría detallado para la herramienta
                    await db_manager.log_audit(
                        agent_role=role.name,
                        action="tool_execution",
                        user_id=user_id,
                        tool_name=selected_tool_name,
                        authorization_result="success",
                    )

                    # Segunda llamada al LLM con el RESULTADO de la tool, para que la
                    # respuesta final integre los datos (horarios, confirmaciones, etc.).
                    # Se omite para tools de confirmación simple (mensaje ya listo para
                    # el usuario) -> reduce a la mitad la latencia del flujo con tools.
                    simple_tool = selected_tool_name in _SIMPLE_CONFIRM_TOOLS
                    if (
                        isinstance(tool_result, dict)
                        and tool_result.get("status") == "success"
                        and not tool_result.get("requires_human")
                        and not transfer_target
                        and not simple_tool
                    ):
                        await event_bus.publish(conversation_id, {"type": "reasoning"})
                        try:
                            llm_final = await self._call_deepseek_llm(
                                role,
                                user_input,
                                context,
                                authorized_tools,
                                tool_result=tool_result,
                                conversation_id=conversation_id,
                                stats=stats,
                                phase="synthesize",
                            )
                            respuesta_final = (llm_final or {}).get("answer") or ""
                            if respuesta_final:
                                final_answer = respuesta_final
                        except Exception as exc:
                            logger.error("Error en la llamada final con resultado de tool: %s", exc)
                    elif (
                        simple_tool
                        and isinstance(tool_result, dict)
                        and tool_result.get("status") == "success"
                        and not tool_result.get("requires_human")
                    ):
                        # Tools de confirmación simple: la respuesta final DEBE ser el mensaje
                        # de la tool (contiene avisos importantes, p.ej. pedir al usuario que
                        # verifique su correo), no la respuesta preliminar del LLM.
                        final_answer = tool_result.get("message") or final_answer

                    # Escalación a operador humano: crear Tarea + Aprobación para la consola de Workflows
                    if tool_result.get("requires_human"):
                        esc_task = TaskModel(
                            id=f"TSK-{uuid.uuid4().hex[:8]}",
                            conversation_id=conversation_id,
                            type="human_escalation",
                            goal="Escalar conversación a operador humano",
                            status=TaskStatus.WAITING_HUMAN,
                            context={
                                "tool_name": selected_tool_name,
                                "tool_args": tool_args,
                                "ticket_id": tool_result.get("ticket_id"),
                            },
                        )
                        await db_manager.create_task(esc_task)

                        esc_approval = ApprovalModel(
                            id=f"APP-{uuid.uuid4().hex[:8]}",
                            task_id=esc_task.id,
                            target_type="human_escalation",
                            action="human_handoff",
                            status=ApprovalStatus.PENDING,
                            reason="El usuario solicitó hablar con un operador humano.",
                        )
                        await db_manager.create_approval(esc_approval)
                        created_task_dict = esc_task.dict()

                        # Pausar el agente: la conversación pasa a ser atendida por un humano.
                        # Los mensajes del cliente se registran pero el modelo deja de responder.
                        await db_manager.update_conversation_status(conversation_id, "paused_human")
                        stats.outcome = "hitl"

                        base_msg = tool_result.get(
                            "message", "Tu solicitud ha sido escalada a un operador humano."
                        )
                        final_answer = f"{base_msg} Un operador te atenderá en breve por esta conversación."

                    if not final_answer:
                        final_answer = tool_result.get("message", "Acción completada con éxito.")

        # Traspaso entre agentes: continuar la conversación con el rol destino para que
        # el nuevo agente responda de inmediato (p.ej. ofrece horarios para la cita).
        if transfer_target and transfer_target != role.name:
            stats.outcome = "transfer"
            stats.role = transfer_target
            await db_manager.add_message(
                MessageModel(
                    id=f"MSG-{uuid.uuid4().hex[:8]}",
                    conversation_id=conversation_id,
                    sender="agent",
                    content=final_answer,
                    tool_calls=executed_tool_calls,
                )
            )
            try:
                continuacion, tools_continuacion = await self._continuar_con_rol(
                    conversation_id=conversation_id,
                    user_input=user_input,
                    nuevo_role=RoleSystem.get_role(transfer_target),
                    all_registered=all_registered,
                    context=context,
                    stats=stats,
                )
                final_answer = continuacion
                executed_tool_calls = executed_tool_calls + tools_continuacion
            except Exception as exc:
                logger.error("Error continuando la conversación tras el traspaso: %s", exc)

        return await self._finalize_turn(
            conversation_id=conversation_id,
            role_name=transfer_target or role.name,
            user_id=user_id,
            stats=stats,
            final_answer=final_answer,
            executed_tool_calls=executed_tool_calls,
            created_task_dict=created_task_dict,
            requires_approval=requires_approval,
            context=context,
        )

    async def _call_deepseek_llm(
        self,
        role: RoleModel,
        user_input: str,
        context: Dict[str, Any],
        tools: List[Dict[str, Any]],
        tool_result: Optional[Dict[str, Any]] = None,
        conversation_id: Optional[str] = None,
        stats: Optional[_RunStats] = None,
        phase: str = "plan",
    ) -> Dict[str, Any]:
        """Arma el prompt y pide una completion. El HTTP vive en LlmPort."""
        system_prompt = build_system_prompt(
            role=role,
            tools=tools,
            context=context,
            tool_result=tool_result,
        )
        result = await self.llm.complete(system_prompt, user_input)
        self._record_llm_result(stats, result, phase)
        if result.ok and result.content:
            try:
                return json.loads(result.content)
            except json.JSONDecodeError:
                logger.error("Completion LLM no es JSON válido")
        if tool_result is not None:
            msg = (tool_result or {}).get("message") or "Acción completada."
            return {"answer": msg, "tool_to_call": None, "tool_args": {}}
        if settings.allow_heuristic_fallback:
            return await heuristic_plan(user_input, tools, role.name, conversation_id)
        logger.error("LLM no disponible en producción; no se usa heurística")
        if stats and stats.outcome == "success":
            stats.outcome = "llm_fallback"
        return {
            "answer": (
                "No pude completar la respuesta en este momento. "
                "Inténtalo de nuevo en unos minutos."
            ),
            "tool_to_call": None,
            "tool_args": {},
        }

    @staticmethod
    def _record_llm_result(stats: Optional[_RunStats], result: LlmResult, phase: str) -> None:
        if not stats:
            return
        if not result.attempts:
            if result.source != "llm":
                stats.note_llm(status="fallback", latency_ms=0, phase=phase)
            return
        for att in result.attempts:
            stats.note_llm(
                status=att.status,
                latency_ms=att.latency_ms,
                prompt=att.prompt_tokens,
                completion=att.completion_tokens,
                phase=phase,
                http_status=att.http_status,
                attempt=att.attempt,
            )
        if not result.ok:
            stats.note_llm(status="fallback", latency_ms=0, phase=phase, attempt=max(a.attempt for a in result.attempts))
            if stats.outcome == "success":
                stats.outcome = "llm_fallback"

    async def _continuar_con_rol(
        self,
        *,
        conversation_id: str,
        user_input: str,
        nuevo_role: RoleModel,
        all_registered: List[Dict[str, Any]],
        context: Dict[str, Any],
        stats: Optional[_RunStats] = None,
    ) -> tuple:
        """Continúa la conversación con el rol destino tras un traspaso.

        Hace una pasada del nuevo agente sobre el mismo mensaje del usuario (con el
        historial ya actualizado) y, si elige una tool (p.ej. check_availability),
        la ejecuta y formula la respuesta final. Devuelve (respuesta, tool_calls).
        """
        nuevo_context = await MemoryRetriever.get_context(
            conversation_id, nuevo_role.name, nuevo_role.allowed_knowledge_sources, user_input
        )
        nuevo_tools = PolicyEngine.filter_authorized_tools(nuevo_role, all_registered)
        llm = await self._call_deepseek_llm(
            nuevo_role,
            user_input,
            nuevo_context,
            nuevo_tools,
            conversation_id=conversation_id,
            stats=stats,
            phase="transfer_plan",
        )
        answer = (llm or {}).get("answer") or ""
        tool_name = (llm or {}).get("tool_to_call")
        tool_args = (llm or {}).get("tool_args") or {}
        extra_tools: List[Dict[str, Any]] = []

        if tool_name and tool_name != "transfer_to_agent" and PolicyEngine.is_tool_allowed(nuevo_role, tool_name):
            tool_def = tool_registry.get_tool(tool_name)
            if tool_def:
                exec_args = await prepare_tool_args(
                    tool_name, dict(tool_args), conversation_id=conversation_id, user_input=user_input
                )
                tool_result = await tool_registry.execute_tool(tool_name, **exec_args)
                await db_manager.log_tool_execution(
                    conversation_id=conversation_id,
                    tool_name=tool_name,
                    input_data=tool_args,
                    output_data=tool_result,
                    status=tool_result.get("status", "success") if isinstance(tool_result, dict) else "success",
                    execution_time_ms=0,
                )
                extra_tools.append({"tool": tool_name, "result": tool_result})
                if stats:
                    stats.tool_calls += 1
                if (
                    isinstance(tool_result, dict)
                    and tool_result.get("status") == "success"
                    and not tool_result.get("requires_human")
                ):
                    llm_final = await self._call_deepseek_llm(
                        nuevo_role,
                        user_input,
                        nuevo_context,
                        nuevo_tools,
                        tool_result=tool_result,
                        conversation_id=conversation_id,
                        stats=stats,
                        phase="transfer_synthesize",
                    )
                    answer = (llm_final or {}).get("answer") or tool_result.get("message", answer)
                else:
                    answer = tool_result.get("message", answer)

        await db_manager.log_audit(
            agent_role=nuevo_role.name,
            action="agent_execution",
            authorization_result="authorized",
        )
        return answer, extra_tools

    async def _run_with_port(
        self,
        *,
        conversation_id: str,
        user_input: str,
        role: RoleModel,
        channel: str,
        user_id: Optional[str],
        customer_id: Optional[str],
        context: Dict[str, Any],
        authorized_tools: List[Dict[str, Any]],
        all_registered: List[Dict[str, Any]],
        stats: _RunStats,
    ) -> AgentRuntimeResult:
        hops = 0
        current_role = role
        executed: List[Dict[str, Any]] = []
        created_task_dict = None
        requires_approval = False
        final_answer = ""
        current_context = context
        current_tools = authorized_tools

        while hops <= 1:
            turn = TurnInput(
                conversation_id=conversation_id,
                user_input=user_input,
                role=current_role,
                context=current_context,
                authorized_tools=current_tools,
                channel=channel,
                user_id=user_id,
                customer_id=customer_id,
            )
            output = await self.agent_port.run(turn)
            stats.note_llm(
                status="success",
                latency_ms=0,
                prompt=output.prompt_tokens,
                completion=output.completion_tokens,
                phase="pydantic",
                attempt=max(output.llm_requests, 1),
            )
            executed.extend(output.tool_calls)
            stats.tool_calls += len(output.tool_calls)

            for tc in output.tool_calls:
                tname = tc.get("tool") or ""
                tres = tc.get("result") if isinstance(tc.get("result"), dict) else {}
                await event_bus.publish(
                    conversation_id,
                    {"type": "tool_completed", "tool": tname, "status": tres.get("status", "success")},
                )
                await db_manager.log_tool_execution(
                    conversation_id=conversation_id,
                    tool_name=tname,
                    input_data=tc.get("args") or {},
                    output_data=tres,
                    status=tres.get("status", "success"),
                )
                await memory_service.record_from_tool(
                    conversation_id=conversation_id,
                    role_name=current_role.name,
                    tool_name=tname,
                    tool_args=tc.get("args") or {},
                )
                await db_manager.log_audit(
                    agent_role=current_role.name,
                    action="tool_execution",
                    user_id=user_id,
                    tool_name=tname,
                    authorization_result="success",
                )
                if tres.get("requires_human") and tname == "escalate_ticket":
                    esc_task = TaskModel(
                        id=f"TSK-{uuid.uuid4().hex[:8]}",
                        conversation_id=conversation_id,
                        type="human_escalation",
                        goal="Escalar conversación a operador humano",
                        status=TaskStatus.WAITING_HUMAN,
                        context={"tool_name": tname, "tool_args": tc.get("args") or {}, "ticket_id": tres.get("ticket_id")},
                    )
                    await db_manager.create_task(esc_task)
                    await db_manager.create_approval(
                        ApprovalModel(
                            id=f"APP-{uuid.uuid4().hex[:8]}",
                            task_id=esc_task.id,
                            target_type="human_escalation",
                            action="human_handoff",
                            status=ApprovalStatus.PENDING,
                            reason="El usuario solicitó hablar con un operador humano.",
                        )
                    )
                    created_task_dict = esc_task.model_dump() if hasattr(esc_task, "model_dump") else esc_task.dict()
                    await db_manager.update_conversation_status(conversation_id, "paused_human")
                    stats.outcome = "hitl"
                    final_answer = (
                        f"{tres.get('message', 'Tu solicitud ha sido escalada a un operador humano.')} "
                        "Un operador te atenderá en breve por esta conversación."
                    )

            if output.deferred:
                requires_approval = True
                stats.outcome = "hitl"
                task = TaskModel(
                    id=f"TSK-{uuid.uuid4().hex[:8]}",
                    conversation_id=conversation_id,
                    type="human_approval",
                    goal=f"Ejecución sensible de tool '{output.deferred.tool_name}'",
                    status=TaskStatus.WAITING_HUMAN,
                    approval_required=True,
                    approval_status=ApprovalStatus.PENDING,
                    context={
                        "tool_name": output.deferred.tool_name,
                        "tool_args": output.deferred.tool_args,
                        "tool_call_id": output.deferred.tool_call_id,
                        "message_history": output.deferred.message_history,
                        "schema_version": 1,
                        "role": current_role.name,
                    },
                )
                await db_manager.create_task(task)
                await db_manager.create_approval(
                    ApprovalModel(
                        id=f"APP-{uuid.uuid4().hex[:8]}",
                        task_id=task.id,
                        target_type="tool_execution",
                        action=output.deferred.tool_name,
                        status=ApprovalStatus.PENDING,
                        new_value=json.dumps(output.deferred.tool_args),
                        reason=f"La herramienta '{output.deferred.tool_name}' requiere aprobación humana.",
                    )
                )
                created_task_dict = task.model_dump() if hasattr(task, "model_dump") else task.dict()
                executed.append({"tool": output.deferred.tool_name, "status": "waiting_human", "task_id": task.id})
                final_answer = output.answer
                break

            if output.transfer_to and output.transfer_to != current_role.name and hops == 0:
                await db_manager.update_conversation_role(conversation_id, output.transfer_to)
                stats.outcome = "transfer"
                stats.role = output.transfer_to
                hops += 1
                current_role = RoleSystem.get_role(output.transfer_to)
                current_context = await MemoryRetriever.get_context(
                    conversation_id, current_role.name, current_role.allowed_knowledge_sources, user_input
                )
                current_tools = PolicyEngine.filter_authorized_tools(current_role, all_registered)
                continue

            if not final_answer:
                final_answer = output.answer
            break

        return await self._finalize_turn(
            conversation_id=conversation_id,
            role_name=current_role.name,
            user_id=user_id,
            stats=stats,
            final_answer=final_answer,
            executed_tool_calls=executed,
            created_task_dict=created_task_dict,
            requires_approval=requires_approval,
            context=current_context,
        )

    async def resume_from_approval(
        self,
        *,
        conversation_id: str,
        task: TaskModel,
        approved: bool,
        override_args: Optional[Dict[str, Any]] = None,
        reason: Optional[str] = None,
    ) -> AgentRuntimeResult:
        """Reanuda un turno pausado por HITL."""
        from app.application.agent.ports import ApprovalDecision

        ctx = task.context or {}
        role_name = ctx.get("role") or "customer_support"
        role = RoleSystem.get_role(role_name)
        user_input = ""
        messages = await db_manager.get_messages(conversation_id, limit=10)
        for m in reversed(messages or []):
            if getattr(m, "sender", None) == "user":
                user_input = m.content or ""
                break
        context = await MemoryRetriever.get_context(
            conversation_id, role.name, role.allowed_knowledge_sources, user_input
        )
        authorized = PolicyEngine.filter_authorized_tools(role, tool_registry.list_tools())
        history = ctx.get("message_history") or []
        tool_call_id = ctx.get("tool_call_id") or ""
        stats = _RunStats(run_id=f"RUN-{uuid.uuid4().hex[:12]}", conversation_id=conversation_id, role=role.name)
        executed: List[Dict[str, Any]] = []
        final_answer = ""
        if history and tool_call_id:
            turn = TurnInput(
                conversation_id=conversation_id,
                user_input=user_input,
                role=role,
                context=context,
                authorized_tools=authorized,
            )
            output = await self.agent_port.resume(
                turn,
                ApprovalDecision(
                    approved=approved,
                    tool_call_id=tool_call_id,
                    message_history=history,
                    override_args=override_args,
                    denial_message=reason,
                ),
            )
            executed = output.tool_calls
            final_answer = output.answer
            stats.tool_calls = len(executed)
        else:
            tool_name = ctx.get("tool_name")
            tool_args = override_args or ctx.get("tool_args") or {}
            if approved and tool_name:
                exec_args = await prepare_tool_args(
                    tool_name, dict(tool_args), conversation_id=conversation_id, user_input=user_input
                )
                tool_result = await tool_registry.execute_tool(tool_name, **exec_args)
                executed = [{"tool": tool_name, "result": tool_result}]
                final_answer = (tool_result or {}).get("message") or "Operación completada."
            else:
                final_answer = "La operación no se ejecutó: fue rechazada por un supervisor."

        return await self._finalize_turn(
            conversation_id=conversation_id,
            role_name=role.name,
            user_id=None,
            stats=stats,
            final_answer=final_answer,
            executed_tool_calls=executed,
            created_task_dict=None,
            requires_approval=False,
            context=context,
        )

    async def _finalize_turn(
        self,
        *,
        conversation_id: str,
        role_name: str,
        user_id: Optional[str],
        stats: _RunStats,
        final_answer: str,
        executed_tool_calls: List[Dict[str, Any]],
        created_task_dict: Optional[Dict[str, Any]],
        requires_approval: bool,
        context: Optional[Dict[str, Any]],
    ) -> AgentRuntimeResult:
        if context and context.get("rag_context"):
            stats.used_rag = True
            stats.rag_chunks = len(context["rag_context"])
            await db_manager.log_tool_execution(
                conversation_id=conversation_id,
                tool_name="search_documents",
                input_data={"chunk_count": stats.rag_chunks},
                output_data={"results_count": stats.rag_chunks},
                status="success",
            )

        if not final_answer:
            final_answer = "He procesado tu solicitud correctamente."

        final_answer = self._normalizar_formato(final_answer)
        final_answer = limpiar_texto_final(final_answer)

        await db_manager.add_message(
            MessageModel(
                id=f"MSG-{uuid.uuid4().hex[:8]}",
                conversation_id=conversation_id,
                sender="agent",
                content=final_answer,
                tool_calls=executed_tool_calls,
            )
        )
        await db_manager.log_audit(
            agent_role=role_name,
            action="agent_execution",
            user_id=user_id,
            authorization_result="approval_requested" if requires_approval else "authorized",
        )
        await event_bus.publish(conversation_id, {"type": "done"})
        return AgentRuntimeResult(
            response_text=final_answer,
            conversation_id=conversation_id,
            role=role_name,
            tool_calls=executed_tool_calls,
            task_created=created_task_dict,
            requires_human_approval=requires_approval,
        )

    @staticmethod
    def _normalizar_formato(texto: str) -> str:
        """Limpieza ligera del texto final: evita muros de texto y saltos excesivos."""
        import re

        texto = (texto or "").strip()
        # Máximo 1 línea en blanco entre párrafos
        texto = re.sub(r"\n{3,}", "\n\n", texto)
        return texto

agent_runtime = AgentRuntime()
