"""
Tool Registry centralizado para Synckre Agent V2.
Permite registrar, inspeccionar y invocar herramientas con schemas, capacidades requeridas,
niveles de riesgo, necesidad de aprobación y estrategias de idempotencia.
"""

import inspect
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("tool_registry")


@dataclass
class ToolDefinition:
    name: str
    description: str
    func: Callable
    required_capabilities: List[str]
    risk_level: int = 1  # 1: READ/SAFE, 2: SAFE ACTION, 3: SENSITIVE ACTION
    requires_approval: bool = False
    idempotency_strategy: str = "none"  # 'none', 'task_id', 'args_hash'


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register(
        self,
        name: str,
        description: str,
        required_capabilities: List[str],
        risk_level: int = 1,
        requires_approval: bool = False,
        idempotency_strategy: str = "none",
    ):
        def decorator(func: Callable):
            tool_def = ToolDefinition(
                name=name,
                description=description,
                func=func,
                required_capabilities=required_capabilities,
                risk_level=risk_level,
                requires_approval=requires_approval,
                idempotency_strategy=idempotency_strategy,
            )
            self._tools[name] = tool_def
            logger.info(f"Tool registrada: '{name}' (Riesgo: {risk_level})")
            return func

        return decorator

    def get_tool(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list_tools(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": t.name,
                "description": t.description,
                "required_capabilities": t.required_capabilities,
                "risk_level": t.risk_level,
                "requires_approval": t.requires_approval,
                "idempotency_strategy": t.idempotency_strategy,
                "parameters": self.get_tool_schema(t),
            }
            for t in self._tools.values()
        ]

    @staticmethod
    def get_tool_schema(tool: "ToolDefinition") -> List[Dict[str, Any]]:
        """Devuelve el esquema de parámetros (nombre, requerido, tipo) de la función de la tool."""
        try:
            sig = inspect.signature(tool.func)
        except (TypeError, ValueError):
            return []
        schema = []
        for p in sig.parameters.values():
            if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                continue
            annotation = p.annotation
            type_name = (
                annotation.__name__
                if annotation is not inspect.Parameter.empty and hasattr(annotation, "__name__")
                else "any"
            )
            schema.append(
                {
                    "name": p.name,
                    "required": p.default is inspect.Parameter.empty,
                    "type": type_name,
                }
            )
        return schema

    async def execute_tool(self, name: str, **kwargs) -> Dict[str, Any]:
        tool = self.get_tool(name)
        if not tool:
            return {"status": "permanent_failure", "error": f"Herramienta '{name}' no existe en ToolRegistry."}

        # 1) Validar y limpiar argumentos contra la firma real de la tool.
        #    Evita que un LLM o un humano envíe kwargs inventados y rompa la llamada con TypeError.
        original_args = kwargs
        accepts_extra = False
        params: Dict[str, inspect.Parameter] = {}
        try:
            sig = inspect.signature(tool.func)
            accepts_extra = any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
            )
            params = {
                p.name: p
                for p in sig.parameters.values()
                if p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
            }
        except (TypeError, ValueError):
            params = {}

        # Descartar argumentos desconocidos salvo que la firma acepte **kwargs
        if params and not accepts_extra:
            unknown = set(kwargs) - set(params)
            if unknown:
                logger.warning(
                    f"Tool '{name}': descartando argumentos no soportados {sorted(unknown)} "
                    f"(esperados: {sorted(params)})"
                )
                kwargs = {k: v for k, v in kwargs.items() if k in params}

        # Reportar parámetros requeridos faltantes con feedback accionable
        missing = [
            p.name
            for p in params.values()
            if p.default is inspect.Parameter.empty and p.name not in kwargs
        ]
        if missing:
            return {
                "status": "permanent_failure",
                "error": (
                    f"Faltan parámetros requeridos para '{name}': {', '.join(missing)}. "
                    f"Argumentos recibidos: {json.dumps(original_args)}"
                ),
            }

        try:
            if inspect.iscoroutinefunction(tool.func):
                result = await tool.func(**kwargs)
            else:
                result = tool.func(**kwargs)

            if isinstance(result, dict) and "status" in result:
                return result
            return {"status": "success", "result": result}
        except Exception as exc:
            logger.error(f"Error ejecutando tool '{name}': {exc}", exc_info=True)
            return {"status": "temporary_failure", "error": str(exc)}


tool_registry = ToolRegistry()
