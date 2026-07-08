from langchain_core.messages import AIMessage, HumanMessage

from .graph import build_ta_graph
from .tools import set_ta_auth_context


def _build_history_messages(history: list | None):
    messages = []
    if not history:
        return messages

    for item in history:
        if isinstance(item, str):
            messages.append(HumanMessage(content=item))
            continue

        if not isinstance(item, dict):
            continue

        teacher_message = item.get("teacher_message") or item.get("message")
        ta_response = item.get("ta_response") or item.get("response")

        if teacher_message:
            messages.append(HumanMessage(content=teacher_message))
        if ta_response:
            messages.append(AIMessage(content=ta_response))

        if not teacher_message and not ta_response and item.get("content"):
            if item.get("role") == "assistant":
                messages.append(AIMessage(content=item["content"]))
            else:
                messages.append(HumanMessage(content=item["content"]))

    return messages


async def chat_with_ta(teacher_id: str, message: str, history: list = None, access_token: str = ""):
    """Run TA chat by delegating database questions to the SQL LangGraph agent."""
    graph = build_ta_graph()
    set_ta_auth_context(access_token)

    messages = _build_history_messages(history)
    messages.append(HumanMessage(content=message))

    result = graph.invoke(
        {
            "teacher_id": teacher_id,
            "access_token": access_token,
            "messages": messages,
        },
        config={"recursion_limit": 12},
    )

    final_messages = result.get("messages", [])
    for msg in reversed(final_messages):
        if isinstance(msg, AIMessage) and msg.content and not getattr(msg, "tool_calls", None):
            return msg.content

    return "I could not produce a final response from the SQL agent. Please try rephrasing your question."
