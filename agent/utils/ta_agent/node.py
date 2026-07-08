from typing import Literal

from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END
from langgraph.prebuilt import ToolNode

from .prompt import GENERATE_QUERY_SYSTEM_PROMPT, CHECK_QUERY_SYSTEM_PROMPT
from .state import AgentState
from .tools import tools


model = ChatOpenAI(model="gpt-5.4-mini", temperature=0)

list_tables_tool = next(tool for tool in tools if tool.name == "sql_db_list_tables")
get_schema_tool = next(tool for tool in tools if tool.name == "sql_db_schema")
run_query_tool = next(tool for tool in tools if tool.name == "sql_db_query")
slides_tool = next(tool for tool in tools if tool.name == "twoslides_generate_deck")

get_schema_node = ToolNode([get_schema_tool], name="get_schema")
run_query_node = ToolNode([run_query_tool], name="run_query")


def _latest_user_message_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages", [])):
        if isinstance(msg, HumanMessage):
            return str(msg.content or "")
    return ""


def route_request(state: AgentState) -> Literal["call_slides_agent", "list_tables"]:
    text = _latest_user_message_text(state).lower()
    slides_signals = ["slide", "slides", "ppt", "pptx", "presentation", "deck"]
    if any(signal in text for signal in slides_signals):
        return "call_slides_agent"
    return "list_tables"


def call_slides_agent(state: AgentState):
    user_prompt = _latest_user_message_text(state)
    tool_call = {
        "name": "twoslides_generate_deck",
        "args": {"user_prompt": user_prompt},
        "id": "twoslides_generate",
        "type": "tool_call",
    }
    tool_call_message = AIMessage(content="", tool_calls=[tool_call])
    tool_message = slides_tool.invoke(tool_call)
    return {"messages": [tool_call_message, tool_message]}


def finalize_slides_answer(state: AgentState):
    """Return tool output directly so download URL and slide count stay exact."""
    last_message = state["messages"][-1] if state.get("messages") else None
    content = getattr(last_message, "content", "") if last_message else ""
    return {"messages": [AIMessage(content=str(content or ""))]}


def list_tables(state: AgentState):
    tool_call = {
        "name": "sql_db_list_tables",
        "args": {},
        "id": "sql_list_tables",
        "type": "tool_call",
    }
    tool_call_message = AIMessage(content="", tool_calls=[tool_call])
    tool_message = list_tables_tool.invoke(tool_call)
    return {"messages": [tool_call_message, tool_message]}


def call_get_schema(state: AgentState):
    system_message = {
        "role": "system",
        "content": (
            "From the user's question and available table list, decide relevant tables and call sql_db_schema. "
            "Pass a comma-separated table_names string."
        ),
    }
    llm_with_tools = model.bind_tools([get_schema_tool], tool_choice="any")
    response = llm_with_tools.invoke([system_message] + state["messages"])
    return {"messages": [response]}


def generate_query(state: AgentState):
    teacher_id = state.get("teacher_id", "")
    system_message = {
        "role": "system",
        "content": GENERATE_QUERY_SYSTEM_PROMPT.format(teacher_id=teacher_id),
    }
    llm_with_tools = model.bind_tools([run_query_tool])
    response = llm_with_tools.invoke([system_message] + state["messages"])
    return {"messages": [response]}


def check_query(state: AgentState):
    system_message = {
        "role": "system",
        "content": CHECK_QUERY_SYSTEM_PROMPT,
    }
    last_message = state["messages"][-1]
    if not getattr(last_message, "tool_calls", None):
        return {"messages": []}

    tool_call = last_message.tool_calls[0]
    user_message = {"role": "user", "content": tool_call["args"]["query"]}
    llm_with_tools = model.bind_tools([run_query_tool], tool_choice="any")
    response = llm_with_tools.invoke([system_message, user_message])
    response.id = last_message.id
    return {"messages": [response]}


def finalize_answer(state: AgentState):
    """Create the final natural-language answer from tool outputs without calling tools again."""
    system_message = {
        "role": "system",
        "content": (
            "You are a helpful TA assistant. Use the SQL tool results in the conversation "
            "to answer the user's latest question clearly and concisely. "
            "If no rows were found, say that explicitly."
        ),
    }
    response = model.invoke([system_message] + state["messages"])
    return {"messages": [response]}


def should_continue(state: AgentState) -> Literal[END, "check_query"]:
    last_message = state["messages"][-1]
    if getattr(last_message, "tool_calls", None):
        return "check_query"
    return END
