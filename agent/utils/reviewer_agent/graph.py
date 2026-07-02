from .state import AssignmentState
from langgraph.graph import StateGraph, START, END
from .node import (
    init_supervisor_node,
    fetch_next_context_node,
    grader_1_node,
    grader_2_node,
    weakness_analyzer_node,
    aggregate_results_node,
    supervisor_router,
)


def build_graph():
    workflow = StateGraph(AssignmentState)

    # Add Nodes
    workflow.add_node("init_supervisor", init_supervisor_node)
    workflow.add_node("fetch_next_context", fetch_next_context_node)
    workflow.add_node("grader_1", grader_1_node)
    workflow.add_node("grader_2", grader_2_node)
    workflow.add_node("weakness_analyzer", weakness_analyzer_node)
    workflow.add_node("aggregate", aggregate_results_node)

    # Edges
    workflow.add_edge(START, "init_supervisor")

    # After init: if labels exist -> fetch first, else -> END
    workflow.add_conditional_edges(
        "init_supervisor",
        supervisor_router,
        {"fetch_next": "fetch_next_context", "END": END}
    )

    # Parallel Fan-out: fetch context triggers grader_1, grader_2, AND weakness_analyzer
    workflow.add_edge("fetch_next_context", "grader_1")
    workflow.add_edge("fetch_next_context", "grader_2")
    workflow.add_edge("fetch_next_context", "weakness_analyzer")

    # Parallel Fan-in: all three must finish before aggregating
    workflow.add_edge("grader_1", "aggregate")
    workflow.add_edge("grader_2", "aggregate")
    workflow.add_edge("weakness_analyzer", "aggregate")

    # After aggregate: loop back if more labels, else END
    workflow.add_conditional_edges(
        "aggregate",
        supervisor_router,
        {"fetch_next": "fetch_next_context", "END": END}
    )

    return workflow.compile()
