from langgraph.pregel import Pregel

from agent.graph import MEMBERS, build_graph, graph


def test_graph_es_pregel() -> None:
    assert isinstance(graph, Pregel)


def test_build_graph_devuelve_pregel() -> None:
    assert isinstance(build_graph(), Pregel)


def test_members_supervisor_workers() -> None:
    assert set(MEMBERS) == {"researcher", "writer", "coder"}
