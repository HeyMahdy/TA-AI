from typing import TypedDict, Annotated
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    teacher_id: str
    access_token: str
    messages: Annotated[list[BaseMessage], add_messages]
