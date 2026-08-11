"""Grafo multi-agente: supervisor que rutea entre workers especializados.

Workers: researcher (investigador), writer (redactor) y coder (programador).
Todos usan DeepSeek (ChatDeepSeek). El supervisor decide qué worker actúa
en cada turno mediante tool-calling y finaliza con FINISH.

El grafo se compila sin checkpointer a nivel de módulo (para LangGraph Studio);
la API lo recompila con el checkpointer de Postgres vía build_graph().
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Callable, Literal, cast

from langchain_core.messages import AnyMessage, SystemMessage
from langchain_core.tools import tool
from langchain_deepseek import ChatDeepSeek
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

MEMBERS: tuple[str, ...] = ("researcher", "writer", "coder")

SUPERVISOR_PROMPT = """Eres el supervisor de un equipo de agentes especializados. Tu única tarea es decidir \
qué worker debe actuar a continuación, o finalizar la conversación.

Workers disponibles:
- researcher: investiga, analiza y reúne información o datos; razona sobre preguntas complejas.
- writer: redacta, edita, corrige y pule textos en cualquier idioma.
- coder: escribe, revisa, corrige y explica código y tareas de programación.

Reglas:
1. Debes llamar SIEMPRE a la herramienta route_to_worker indicando el worker elegido.
2. Elige UN solo worker por turno; después de su respuesta volverás a decidir.
3. Cuando la petición esté completa o no requiera ningún worker, elige FINISH.
4. Nunca resuelvas la petición tú mismo: delega en un worker o finaliza."""

WORKER_PROMPTS: dict[str, str] = {
    "researcher": """Eres el worker "investigador" de un equipo dirigido por un supervisor.
Analiza la petición, razona paso a paso y entrega información precisa y bien estructurada.
No inventes datos: si no estás seguro, indícalo explícitamente.""",
    "writer": """Eres el worker "redactor" de un equipo dirigido por un supervisor.
Redacta, edita o pule textos con claridad y buen estilo, en el idioma de la petición.
Mantén el tono adecuado al contexto y revisa la ortografía y gramática.""",
    "coder": """Eres el worker "programador" de un equipo dirigido por un supervisor.
Escribe y explica código correcto, claro y seguro. Muestra ejemplos cuando ayude
y señala los supuestos o dependencias necesarias.""",
}


class Context(TypedDict):
    """Parámetros configurables por asistente (LangGraph Studio)."""

    my_configurable_param: str


class State(TypedDict):
    """Estado del grafo.

    - messages: conversación visible (human + respuestas de los workers), limpia
      de tool-calls para no confundir al LLM.
    - routing: historial de decisiones del supervisor (canal separado).
    - next: worker elegido en el último turno del supervisor.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    routing: Annotated[list[str], operator.add]
    next: str


@tool
def route_to_worker(
    next_worker: Literal["researcher", "writer", "coder", "FINISH"],
) -> str:
    """Indica qué worker debe encargarse del siguiente paso de la conversación.

    Args:
        next_worker: worker elegido; usa FINISH cuando la petición esté completa.
    """
    return next_worker


def create_model(*, timeout: float = 60.0) -> ChatDeepSeek:
    """Crea el modelo DeepSeek con timeout explícito en las llamadas al LLM."""
    return ChatDeepSeek(model="deepseek-chat", timeout=timeout)


modelo = create_model()


def _make_supervisor_node(llm: ChatDeepSeek) -> Callable[[State], dict[str, Any]]:
    """Crea el nodo supervisor que rutea al siguiente worker (o FINISH).

    Las decisiones se registran en el canal `routing` (nunca en `messages`),
    así la conversación queda limpia y DeepSeek no recibe tool-calls huérfanas.
    """

    def supervisor_node(state: State) -> dict[str, Any]:
        decisiones = state.get("routing", [])[-5:]
        contexto = (
            "Decisiones previas del supervisor: "
            + (" → ".join(decisiones) if decisiones else "ninguna")
            + ". Si la última respuesta del asistente ya responde por completo la "
            "petición del usuario, elige FINISH."
        )
        messages = [
            SystemMessage(content=f"{SUPERVISOR_PROMPT}\n\n{contexto}"),
            *state["messages"],
        ]
        response = llm.bind_tools([route_to_worker]).invoke(messages)
        tool_calls = getattr(response, "tool_calls", None) or []
        goto = "FINISH"
        if tool_calls:
            raw = str(
                (tool_calls[0].get("args") or {}).get("next_worker")
                or tool_calls[0].get("name")
                or "FINISH"
            )
            goto = raw if raw in (*MEMBERS, "FINISH") else "FINISH"
        return {"next": goto, "routing": [goto]}

    return supervisor_node


def _make_worker_node(
    llm: ChatDeepSeek, member: str
) -> Callable[[State], dict[str, list[AnyMessage]]]:
    """Crea un nodo worker que responde con el LLM usando su system prompt propio."""

    def worker_node(state: State) -> dict[str, list[AnyMessage]]:
        messages = [SystemMessage(content=WORKER_PROMPTS[member]), *state["messages"]]
        response = llm.invoke(messages)
        return {"messages": [response]}

    return worker_node


def _route_after_supervisor(state: State) -> str:
    """Devuelve el worker elegido o END si el supervisor finalizó."""
    goto = state.get("next", "FINISH")
    return goto if goto in MEMBERS else END


def build_graph(llm: ChatDeepSeek | None = None, checkpointer: Any = None) -> Any:
    """Compila el grafo supervisor + workers, opcionalmente con checkpointer."""
    llm = llm or modelo
    builder = StateGraph(State, context_schema=Context)
    builder.add_node("supervisor", cast(Any, _make_supervisor_node(llm)))
    for member in MEMBERS:
        builder.add_node(member, cast(Any, _make_worker_node(llm, member)))
    builder.add_edge(START, "supervisor")
    builder.add_conditional_edges(
        "supervisor",
        _route_after_supervisor,
        cast(Any, {member: member for member in MEMBERS} | {END: END}),
    )
    for member in MEMBERS:
        builder.add_edge(member, "supervisor")
    return builder.compile(checkpointer=checkpointer, name="Synckre Supervisor")


graph = build_graph()
