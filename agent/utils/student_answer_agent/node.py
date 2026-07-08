import json
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import ToolNode
from utils.document_content import build_document_human_content
from .tools import tools
from .state import AgentState
from .prompt import STUDENT_ANSWER_PROMPT, system_prompt

load_dotenv()

# 1. Initialize LLMs
llm = ChatOpenAI(model="gpt-5.4-mini", temperature=0)

# The saving agent MUST have tools bound to it
agent_llm = llm.bind_tools(tools)

# 2. Tool Node
tool_node = ToolNode(tools)

# ---------------------------------------------------------
# NODE 1: The Student Answer Extractor
# ---------------------------------------------------------
def dynamic_extract_node(state: AgentState):
    """Extracts student answer text using the vision model."""

    active_prompt = STUDENT_ANSWER_PROMPT

    messages = [SystemMessage(content=active_prompt)]

    human_content = build_document_human_content(
        state.get("files", []),
        (
            "Look at this document and transcribe ONLY the student answers that are PHYSICALLY VISIBLE. "
            "Do NOT invent or generate any answers that are not written in the document. "
            "If you see only 1 answer, output only 1. "
            "Wrap all math in LaTeX ($...$)."
        ),
    )

    messages.append(HumanMessage(content=human_content))

    json_llm = llm.bind(response_format={"type": "json_object"})
    response = json_llm.invoke(messages)

    try:
        parsed_string = json.loads(response.content)
        final_string_payload = json.dumps(parsed_string, ensure_ascii=False)
    except Exception:
        final_string_payload = response.content

    return {"final_output": final_string_payload}


# ---------------------------------------------------------
# NODE 2: The Agent Brain (Targeted for Student Answers)
# ---------------------------------------------------------
def save_with_agent(state: AgentState):
    """Decides which tools to call based on the extracted Student Answer JSON."""

    print("\n" + "=" * 50)
    print(f"[save_with_agent] Entering node.")
    print(f"[save_with_agent] State -> teacher_id: {state.get('teacher_id')}, student_id: {state.get('student_id')}, assignment_id: {state.get('assignment_id')}")
    print(f"[save_with_agent] Current message count: {len(state.get('messages', []))}")

    if not state.get("messages"):
        print("[save_with_agent] FIRST PASS (No previous messages).")

        raw_json_string = state.get("final_output", "{}")
        parsed_data = json.loads(raw_json_string)

        answers_list = parsed_data.get("answers", [])
        formatted_answers_block = json.dumps(answers_list, indent=2)

        initial_instruction = system_prompt.format(
            teacher_id=state["teacher_id"],
            student_id=state["student_id"],
            assignment_id=state["assignment_id"],
        ) + f"\n\nHere is the exact data array you must loop over and save using the 'insert_student_answer' tool:\n{formatted_answers_block}"

        messages_to_process = [HumanMessage(content=initial_instruction)]
    else:
        print("[save_with_agent] LOOPING BACK. Using existing message history.")
        messages_to_process = state["messages"]

    print(f"[save_with_agent] Invoking LLM with {len(messages_to_process)} messages...")

    response = agent_llm.invoke(messages_to_process)

    print(f"[save_with_agent] LLM Responded.")

    if hasattr(response, "tool_calls") and response.tool_calls:
        print(f"[save_with_agent] LLM requested {len(response.tool_calls)} tool calls.")
    else:
        print("[save_with_agent] No tool calls requested. Finished.")

    print("=" * 50 + "\n")

    return {"messages": [response]}
