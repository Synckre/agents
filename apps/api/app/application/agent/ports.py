"""Puertos del Agent Runtime. Sin I/O: las implementaciones viven en infrastructure."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Protocol


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
