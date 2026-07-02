from typing import TypedDict
import operator
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage

class AgentState(TypedDict):
	file_content: str
	file_type: str
	final_output: str
	teacher_id: str
	student_id: str
	assignment_id: int

	extracted_data: str
	messages: Annotated[Sequence[BaseMessage], operator.add]
