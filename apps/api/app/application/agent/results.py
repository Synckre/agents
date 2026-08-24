"""Contrato de resultado de tools. Independiente del SDK del agente."""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class ToolStatus(str, Enum):
    success = "success"
    permanent_failure = "permanent_failure"
    temporary_failure = "temporary_failure"
    needs_user = "needs_user"
    requires_human = "requires_human"


class ToolResult(BaseModel):
    status: ToolStatus
    message: str = ""
    data: Dict[str, Any] = Field(default_factory=dict)
    transfer_to: Optional[str] = None
    error: Optional[str] = None
    requires_human: bool = False
    needs_user: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Dict compatible con el runtime y las tools actuales."""
        out: Dict[str, Any] = {"status": self.status.value, **self.data}
        if self.message:
            out.setdefault("message", self.message)
        if self.transfer_to:
            out["transfer_to"] = self.transfer_to
        if self.error:
            out["error"] = self.error
        if self.requires_human or self.status is ToolStatus.requires_human:
            out["requires_human"] = True
        if self.needs_user or self.status is ToolStatus.needs_user:
            out["needs_user"] = True
        return out

    @classmethod
    def from_raw(cls, raw: Any) -> "ToolResult":
        if isinstance(raw, ToolResult):
            return raw
        if not isinstance(raw, dict):
            return cls(status=ToolStatus.success, data={"result": raw})

        status_raw = raw.get("status") or "success"
        try:
            status = ToolStatus(status_raw)
        except ValueError:
            status = ToolStatus.success
        requires_human = bool(raw.get("requires_human"))
        needs_user = bool(raw.get("needs_user"))
        if requires_human and status is ToolStatus.success:
            status = ToolStatus.requires_human
        if needs_user and status is ToolStatus.success:
            status = ToolStatus.needs_user

        reserved = {
            "status",
            "message",
            "error",
            "transfer_to",
            "requires_human",
            "needs_user",
        }
        data = {k: v for k, v in raw.items() if k not in reserved}
        message = raw.get("message") or ""
        error = raw.get("error")
        if not message and error:
            message = str(error)
        return cls(
            status=status,
            message=message,
            data=data,
            transfer_to=raw.get("transfer_to"),
            error=str(error) if error else None,
            requires_human=requires_human or status is ToolStatus.requires_human,
            needs_user=needs_user or status is ToolStatus.needs_user,
        )
