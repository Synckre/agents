"""
Endpoints de Roles para Synckre Agent V2.
Expone la matriz de roles, permisos y políticas configuradas en el runtime.
"""

from fastapi import APIRouter, Depends
from app.application.agent.roles import RoleSystem
from app.interfaces.security import require_any_key

router = APIRouter(prefix="/api/v1/roles", tags=["Roles"], dependencies=[Depends(require_any_key)])


@router.get("", summary="Listar la matriz de roles, políticas y herramientas autorizadas")
async def list_roles():
    roles = RoleSystem.list_roles()
    result = []
    for r in roles:
        level_val = r.autonomy_level.value if hasattr(r.autonomy_level, "value") else int(r.autonomy_level)
        autonomy_label = f"Level {level_val} — {'SENSITIVE ACTION' if level_val >= 3 else 'SAFE ACTION'}"
        result.append(
            {
                "name": r.name,
                "description": r.description,
                "system_policy": r.system_policy,
                "allowed_tools": r.allowed_tools,
                "allowed_knowledge_sources": r.allowed_knowledge_sources,
                "autonomy_level": level_val,
                "autonomy_label": autonomy_label,
                "approval_policy": r.approval_policy,
                "metadata": r.metadata,
            }
        )
    return result
