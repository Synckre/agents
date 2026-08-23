"""Identidad de la petición (sin FastAPI)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

PrincipalKind = Literal["anonymous", "user", "integration"]

ALL_ROLES = {
    "customer_support",
    "sales_assistant",
    "operations_assistant",
    "administrative_assistant",
    "management_assistant",
    "contact_form_agent",
}


@dataclass
class Principal:
    kind: PrincipalKind
    subject: Optional[str] = None
    claims: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_anonymous(self) -> bool:
        return self.kind == "anonymous"


def resolve_allowed_role(principal: Principal | str | None, requested_role: Optional[str]) -> str:
    if isinstance(principal, Principal):
        anonymous = principal.is_anonymous
    else:
        anonymous = principal in (None, "public", "anonymous")
    if anonymous:
        return "contact_form_agent"
    role = (requested_role or "contact_form_agent").strip() or "contact_form_agent"
    return role if role in ALL_ROLES else "contact_form_agent"
