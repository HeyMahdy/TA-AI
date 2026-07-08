from langgraph.graph import START, StateGraph

from .node import (
    route_request,
    call_slides_agent,
    finalize_slides_answer,
    list_tables,
    call_get_schema,
    get_schema_node,
    generate_query,
    check_query,
    run_query_node,
    finalize_answer,
    should_continue,
)
from .state import AgentState


def build_ta_graph():
    builder = StateGraph(AgentState)
    builder.add_node("call_slides_agent", call_slides_agent)
    builder.add_node("finalize_slides_answer", finalize_slides_answer)
    builder.add_node("list_tables", list_tables)
    builder.add_node("call_get_schema", call_get_schema)
    builder.add_node("get_schema", get_schema_node)
    builder.add_node("generate_query", generate_query)
    builder.add_node("check_query", check_query)
    builder.add_node("run_query", run_query_node)
    builder.add_node("finalize_answer", finalize_answer)

    builder.add_conditional_edges(START, route_request)
    builder.add_edge("call_slides_agent", "finalize_slides_answer")
    builder.add_edge("list_tables", "call_get_schema")
    builder.add_edge("call_get_schema", "get_schema")
    builder.add_edge("get_schema", "generate_query")
    builder.add_conditional_edges("generate_query", should_continue)
    builder.add_edge("check_query", "run_query")
    builder.add_edge("run_query", "finalize_answer")
    return builder.compile()
