from langchain_core.messages import HumanMessage, AIMessage

from .graph import build_ta_graph
from .tools import set_ta_auth_context


def _build_history_messages(history: list | None):
    """Convert client history into internal chat messages.

    Preferred client shape:
    {"teacher_message": "...", "ta_response": "..."}

    Legacy {"role": "...", "content": "..."} messages are still accepted so
    existing clients do not break while the public API moves away from roles.
    """
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

        # Backward compatibility for old payloads:
        # {"role": "user" | "assistant", "content": "..."}
        if not teacher_message and not ta_response and item.get("content"):
            if item.get("role") == "assistant":
                messages.append(AIMessage(content=item["content"]))
            else:
                messages.append(HumanMessage(content=item["content"]))

    return messages


async def chat_with_ta(teacher_id: str, message: str, history: list = None, access_token: str = ""):
    """Run a single turn of the TA chatbot using the LangGraph agent."""
    graph = build_ta_graph()
    set_ta_auth_context(access_token)

    messages = _build_history_messages(history)
    messages.append(HumanMessage(content=message))

    # Invoke the graph
    result = graph.invoke({
        "teacher_id": teacher_id,
        "access_token": access_token,
        "messages": messages,
    })

    # Extract the final AI response
    final_messages = result.get("messages", [])
    for msg in reversed(final_messages):
        if isinstance(msg, AIMessage) and msg.content and not getattr(msg, "tool_calls", None):
            return msg.content

    return "I wasn't able to process that request. Could you try rephrasing?"
