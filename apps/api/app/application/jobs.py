"""Cola de trabajo diferido. Sin I/O: el repositorio vive en infrastructure."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional


class JobKind(str, Enum):
    retry_tool = "retry_tool"
    execute_approved_tool = "execute_approved_tool"
    resume_turn = "resume_turn"
    follow_up = "follow_up"


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Job:
    id: str
    kind: str
    run_at: datetime
    payload: Dict[str, Any] = field(default_factory=dict)
    status: str = JobStatus.pending.value
    attempts: int = 0
    max_attempts: int = 5
    locked_at: Optional[datetime] = None
    idempotency_key: Optional[str] = None
    last_error: Optional[str] = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
