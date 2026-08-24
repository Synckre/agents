"""AgentPort respaldado por Pydantic AI. No reescribe tools: las envuelve."""

from __future__ import annotations

import inspect
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from app.application.agent.policies import PolicyEngine
from app.application.agent.ports import (
    AgentUnavailable,
    ApprovalDecision,
    DeferredApproval,
    TurnInput,
    TurnOutput,
)
from app.application.agent.prepare_args import prepare_tool_args
from app.application.agent.language import looks_spanish, user_copy
from app.application.agent.prompts import build_system_prompt
from app.application.agent.roles import RoleModel
from app.application.agent.text import redactar_datos_internos
from app.application.agent.tools_registry import ToolDefinition, tool_registry
from app.application.jobs import JobKind
from app.infrastructure.config import DEEPSEEK_PLACEHOLDER_KEY, settings

logger = logging.getLogger("agent.pydantic")

ExecuteTool = Callable[..., Awaitable[Dict[str, Any]]]
EnqueueJob = Callable[..., Awaitable[Any]]


@dataclass
class TurnDeps:
    conversation_id: str
    user_input: str
    role: RoleModel
    user_language: str = "es"
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    transfer_to: Optional[str] = None
    execute_tool: Optional[ExecuteTool] = None
    enqueue_job: Optional[EnqueueJob] = None


def _annotation_json(annotation: Any) -> Dict[str, Any]:
    name = getattr(annotation, "__name__", "") if annotation is not inspect.Parameter.empty else ""
    return {
        "str": {"type": "string"},
        "int": {"type": "integer"},
        "float": {"type": "number"},
        "bool": {"type": "boolean"},
        "dict": {"type": "object"},
        "list": {"type": "array"},
    }.get(name, {"type": "string"})


def _json_schema_for_tool(tool: ToolDefinition) -> Dict[str, Any]:
    try:
        sig = inspect.signature(tool.func)
    except (TypeError, ValueError):
        return {"type": "object", "properties": {}, "additionalProperties": True}
    properties: Dict[str, Any] = {}
    required: List[str] = []
    for p in sig.parameters.values():
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if p.name == "ctx":
            continue
        properties[p.name] = _annotation_json(p.annotation)
        if p.default is inspect.Parameter.empty:
            required.append(p.name)
    schema: Dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = required
    return schema


def _python_annotation(annotation: Any):
    if annotation is inspect.Parameter.empty:
        return str
    return annotation


def _wrap_tool(tool: ToolDefinition, *, requires_approval: bool):
    from pydantic_ai import RunContext

    orig_sig = inspect.signature(tool.func)
    param_names: List[str] = []
    annotations: Dict[str, Any] = {"return": str}
    defaults: Dict[str, Any] = {}
    for p in orig_sig.parameters.values():
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if p.name == "ctx":
            continue
        param_names.append(p.name)
        annotations[p.name] = _python_annotation(p.annotation)
        if p.default is not inspect.Parameter.empty:
            defaults[p.name] = p.default

    async def impl(ctx: RunContext[TurnDeps], **kwargs: Any) -> str:
        deps = ctx.deps
        exec_args = await prepare_tool_args(
            tool.name,
            kwargs,
            conversation_id=deps.conversation_id,
            user_input=deps.user_input,
        )
        if not PolicyEngine.is_tool_allowed(deps.role, tool.name):
            from pydantic_ai import ModelRetry

            raise ModelRetry(f"La herramienta '{tool.name}' no está autorizada para este rol.")
        if deps.execute_tool is None:
            raise RuntimeError("execute_tool no inyectado")
        result = await deps.execute_tool(tool.name, **exec_args)
        deps.tool_calls.append({"tool": tool.name, "result": result, "args": exec_args})
        if isinstance(result, dict) and result.get("transfer_to"):
            deps.transfer_to = result["transfer_to"]
        if (
            isinstance(result, dict)
            and result.get("status") == "temporary_failure"
            and deps.enqueue_job is not None
        ):
            try:
                await deps.enqueue_job(
                    kind=JobKind.retry_tool.value,
                    payload={
                        "conversation_id": deps.conversation_id,
                        "tool_name": tool.name,
                        "tool_args": exec_args,
                        "role": deps.role.name,
                    },
                    idempotency_key=f"retry:{deps.conversation_id}:{tool.name}:{json.dumps(exec_args, sort_keys=True, default=str)[:80]}",
                )
            except Exception:
                logger.exception("No se pudo encolar retry_tool para %s", tool.name)
        payload = redactar_datos_internos(
            json.dumps(result, ensure_ascii=False)[:2000],
            reemplazo="[referencia interna]",
        )
        lang = getattr(deps, "user_language", "es") or "es"
        if lang == "en":
            hint = "User language: ENGLISH. Any user-facing reply after this tool MUST be English."
        else:
            hint = "Idioma del usuario: ESPAÑOL. La respuesta visible tras esta tool debe ir en español."
        return hint + "\n" + payload

    ctx_p = inspect.Parameter(
        "ctx",
        inspect.Parameter.POSITIONAL_OR_KEYWORD,
        annotation=RunContext[TurnDeps],
    )
    extra = []
    for n in param_names:
        extra.append(
            inspect.Parameter(
                n,
                inspect.Parameter.KEYWORD_ONLY,
                default=defaults[n] if n in defaults else inspect.Parameter.empty,
                annotation=annotations.get(n, str),
            )
        )
    impl.__signature__ = inspect.Signature([ctx_p] + extra, return_annotation=str)
    impl.__name__ = tool.name
    impl.__doc__ = tool.description or tool.name
    impl.__annotations__ = {"ctx": RunContext[TurnDeps], **annotations}

    from pydantic_ai.toolsets import FunctionToolset

    ts = FunctionToolset()
    ts.add_function(
        impl,
        takes_ctx=True,
        name=tool.name,
        description=tool.description or tool.name,
        retries=2,
        requires_approval=requires_approval,
        timeout=45.0,
    )
    # FunctionToolset with one tool; caller combines. Return the tool object.
    return ts, requires_approval


def _combined_toolset(role: RoleModel, authorized: List[Dict[str, Any]]):
    from pydantic_ai.toolsets import CombinedToolset

    parts = []
    names = {t["name"] for t in authorized}
    for name in names:
        tool = tool_registry.get_tool(name)
        if not tool:
            continue
        needs = PolicyEngine.requires_human_approval(role, tool.name, tool.risk_level) or tool.requires_approval
        ts, _ = _wrap_tool(tool, requires_approval=needs)
        parts.append(ts)
    if not parts:
        from pydantic_ai.toolsets import FunctionToolset

        return FunctionToolset()
    if len(parts) == 1:
        return parts[0]
    return CombinedToolset(parts)


def _history_from_context(context: Dict[str, Any], user_input: str):
    from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart

    raw = list(context.get("messages") or [])
    if raw and (raw[-1].get("sender") == "user") and (raw[-1].get("content") or "").strip() == (user_input or "").strip():
        raw = raw[:-1]
    out = []
    for m in raw[-10:]:
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if m.get("sender") == "user":
            out.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        else:
            out.append(ModelResponse(parts=[TextPart(content=content)]))
    return out


def _dump_history(messages: list) -> list:
    from pydantic_ai.messages import ModelMessagesTypeAdapter

    return ModelMessagesTypeAdapter.dump_python(messages, mode="json")


def _load_history(raw: list) -> list:
    from pydantic_ai.messages import ModelMessagesTypeAdapter

    if not raw:
        return []
    return ModelMessagesTypeAdapter.validate_python(raw)


def build_deepseek_model():
    key = (settings.DEEPSEEK_API_KEY or "").strip()
    if settings.SKIP_LLM_KEY_CHECK or not key or key == DEEPSEEK_PLACEHOLDER_KEY:
        return None
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    return OpenAIChatModel(
        settings.DEEPSEEK_MODEL,
        provider=OpenAIProvider(
            base_url=settings.DEEPSEEK_BASE_URL,
            api_key=key,
        ),
    )


class PydanticAgentRuntime:
    def __init__(
        self,
        *,
        model: Any = None,
        execute_tool: Optional[ExecuteTool] = None,
        enqueue_job: Optional[EnqueueJob] = None,
    ) -> None:
        self._model = model
        self._execute_tool = execute_tool or tool_registry.execute_tool
        self._enqueue_job = enqueue_job

    def _resolve_model(self):
        if self._model is not None:
            return self._model
        model = build_deepseek_model()
        if model is None:
            raise AgentUnavailable("DeepSeek no configurado")
        return model

    def _agent(self, turn: TurnInput):
        from pydantic_ai import Agent, DeferredToolRequests
        from pydantic_ai.usage import UsageLimits

        model = self._resolve_model()
        toolset = _combined_toolset(turn.role, turn.authorized_tools)
        instructions = build_system_prompt(
            role=turn.role,
            tools=turn.authorized_tools,
            context=turn.context,
            json_loop=False,
        )
        agent = Agent(
            model,
            deps_type=TurnDeps,
            output_type=[str, DeferredToolRequests],
            toolsets=[toolset],
            instructions=instructions,
        )
        limits = UsageLimits(request_limit=8, tool_calls_limit=5)
        return agent, limits

    def _deps(self, turn: TurnInput) -> TurnDeps:
        return TurnDeps(
            conversation_id=turn.conversation_id,
            user_input=turn.user_input,
            role=turn.role,
            user_language=(turn.context or {}).get("user_language") or "es",
            execute_tool=self._execute_tool,
            enqueue_job=self._enqueue_job,
        )

    def _to_output(self, result: Any, deps: TurnDeps) -> TurnOutput:
        from pydantic_ai import DeferredToolRequests

        usage = result.usage
        prompt_tokens = getattr(usage, "input_tokens", 0) or 0
        completion_tokens = getattr(usage, "output_tokens", 0) or 0
        requests = getattr(usage, "requests", 0) or 0
        deferred = None
        answer = ""
        output = result.output
        if isinstance(output, DeferredToolRequests) and output.approvals:
            part = output.approvals[0]
            args = part.args if isinstance(part.args, dict) else {}
            deferred = DeferredApproval(
                tool_name=part.tool_name,
                tool_args=args,
                tool_call_id=part.tool_call_id,
                message_history=_dump_history(result.all_messages()),
            )
            lang = deps.user_language or "es"
            answer = user_copy("hitl", lang).format(tool=part.tool_name)
        elif isinstance(output, str):
            answer = output
            # TestModel a veces envuelve el resultado de tools en JSON
            if answer.startswith("{") and "status" not in answer[:40]:
                try:
                    parsed = json.loads(answer)
                    if isinstance(parsed, dict) and len(parsed) == 1:
                        only = next(iter(parsed.values()))
                        if isinstance(only, str) and only.startswith("{"):
                            inner = json.loads(only)
                            if isinstance(inner, dict) and inner.get("message"):
                                answer = inner["message"]
                        elif isinstance(only, str):
                            answer = only
                except (json.JSONDecodeError, StopIteration):
                    pass
        else:
            answer = str(output)
        if deps.tool_calls:
            last = deps.tool_calls[-1].get("result") or {}
            if isinstance(last, dict) and last.get("message") and (
                last.get("status") == "success" or last.get("requires_human")
            ):
                # Tools de confirmación: preferir el mensaje de la tool si el modelo no dijo nada útil
                simple = {
                    "create_lead", "update_lead", "add_lead_note", "create_customer",
                    "update_customer", "create_ticket", "update_ticket", "cancel_event",
                    "transfer_to_agent", "send_email", "escalate_ticket",
                    "request_information", "generate_document",
                }
                if deps.tool_calls[-1].get("tool") in simple and last.get("message"):
                    raw_msg = last["message"]
                    jsonish = (not answer) or answer.startswith("{") or len(answer) < 8
                    if jsonish:
                        # No servir un mensaje de tool en español a un usuario en inglés.
                        if deps.user_language == "en" and looks_spanish(raw_msg):
                            answer = answer if answer and not answer.startswith("{") else user_copy(
                                "processed", "en"
                            )
                        else:
                            answer = raw_msg
        return TurnOutput(
            answer=answer or user_copy("processed", deps.user_language or "es"),
            tool_calls=list(deps.tool_calls),
            deferred=deferred,
            transfer_to=deps.transfer_to,
            prompt_tokens=int(prompt_tokens),
            completion_tokens=int(completion_tokens),
            llm_requests=int(requests),
        )

    async def run(self, turn: TurnInput) -> TurnOutput:
        agent, limits = self._agent(turn)
        deps = self._deps(turn)
        history = _history_from_context(turn.context, turn.user_input)
        result = await agent.run(
            turn.user_input,
            deps=deps,
            message_history=history or None,
            usage_limits=limits,
        )
        return self._to_output(result, deps)

    async def resume(self, turn: TurnInput, approval: ApprovalDecision) -> TurnOutput:
        from pydantic_ai import DeferredToolResults, ToolApproved, ToolDenied

        agent, limits = self._agent(turn)
        deps = self._deps(turn)
        history = _load_history(approval.message_history)
        decision: Any
        if approval.approved:
            decision = (
                ToolApproved(override_args=approval.override_args)
                if approval.override_args
                else True
            )
        else:
            decision = ToolDenied(message=approval.denial_message or "La operación fue rechazada.")
        result = await agent.run(
            message_history=history,
            deferred_tool_results=DeferredToolResults(
                approvals={approval.tool_call_id: decision}
            ),
            deps=deps,
            usage_limits=limits,
        )
        return self._to_output(result, deps)
