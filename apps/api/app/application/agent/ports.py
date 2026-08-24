"""Puertos del Agent Runtime. Sin I/O: las implementaciones viven en infrastructure."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

from app.application.agent.roles import RoleModel


class AgentUnavailable(Exception):
    """El SDK del agente no puede correr (sin modelo, sin clave, error de init)."""


@dataclass
class DeferredApproval:
    tool_name: str
    tool_args: Dict[str, Any]
    tool_call_id: str
    message_history: List[Any] = field(default_factory=list)


@dataclass
class ApprovalDecision:
    approved: bool
    tool_call_id: str
    message_history: List[Any] = field(default_factory=list)
    override_args: Optional[Dict[str, Any]] = None
    denial_message: Optional[str] = None


@dataclass
class TurnInput:
    conversation_id: str
    user_input: str
    role: RoleModel
    context: Dict[str, Any]
    authorized_tools: List[Dict[str, Any]]
    channel: str = "api"
    user_id: Optional[str] = None
    customer_id: Optional[str] = None


@dataclass
class TurnOutput:
    answer: str
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    deferred: Optional[DeferredApproval] = None
    transfer_to: Optional[str] = None
    used_fallback: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0
    llm_requests: int = 0


class AgentPort(Protocol):
    async def run(self, turn: TurnInput) -> TurnOutput: ...

    async def resume(self, turn: TurnInput, approval: ApprovalDecision) -> TurnOutput: ...


@dataclass
class LlmAttempt:
    status: str
    latency_ms: int = 0
    attempt: int = 1
    http_status: Optional[int] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class LlmResult:
    """Respuesta cruda del modelo. El runtime parsea JSON y aplica heurística."""

    ok: bool
    content: str = ""
    source: str = "skipped"  # llm | skipped | error
    prompt_tokens: int = 0
    completion_tokens: int = 0
    attempts: List[LlmAttempt] = field(default_factory=list)


class LlmPort(Protocol):
    async def complete(self, system_prompt: str, user_input: str) -> LlmResult:
        """Una completion JSON. Retries internos; no aplica heurística de negocio."""
        ...
