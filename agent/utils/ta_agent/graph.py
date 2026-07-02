from langgraph.graph import StateGraph, START, END

from .state import AgentState
from .node import agent_node, tool_node


def should_continue(state: AgentState):
    """Evaluates the last message to decide the next step."""
    messages = state.get("messages")
    if messages:
        last_message = messages[-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
    return "END"


def build_ta_graph():
    """Builds and compiles the TA agent StateGraph."""
    workflow = StateGraph(AgentState)

    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_node)

    workflow.add_edge(START, "agent")

    workflow.add_conditional_edges(
        "agent",
        should_continue,
        {
            "tools": "tools",
            "END": END,
        },
    )

    workflow.add_edge("tools", "agent")

    return workflow.compile()
