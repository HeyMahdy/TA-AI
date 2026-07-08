import json
import re
from typing import TypedDict
from dotenv import load_dotenv

from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import ToolNode
from utils.document_content import build_document_human_content
from .tools import tools
from .state import AgentState
from .prompt import RUBRIC_PROMPT,system_prompt

load_dotenv()

# 1. Initialize LLMs
llm = ChatOpenAI(model="gpt-5.4-mini", temperature=0)

# CRITICAL FIX: The saving agent MUST have tools bound to it!
agent_llm = llm.bind_tools(tools)

# 2. Tool Node
tool_node = ToolNode(tools)  


def _question_label_key(question_label: object) -> str:
    """Normalize labels just enough to catch spacing/case duplicates."""
    return re.sub(r"\s+", "", str(question_label or "")).lower()


def _dedupe_rubrics_by_question_label(rubrics_list: list) -> list:
    seen_labels = set()
    unique_rubrics = []

    for rubric in rubrics_list:
        label_key = _question_label_key(rubric.get("question_label") if isinstance(rubric, dict) else None)
        if not label_key or label_key in seen_labels:
            continue

        seen_labels.add(label_key)
        unique_rubrics.append(rubric)

    return unique_rubrics

# ---------------------------------------------------------
# NODE 1: The Rubrics Extractor
# ---------------------------------------------------------
def dynamic_extract_node(state: AgentState):
    """Extracts rubric criteria using the vision model and protects mathematical text."""
    
    # 1. Choose the prompt specific to rubrics
    active_prompt = RUBRIC_PROMPT
        
    messages = [SystemMessage(content=active_prompt)]
    
    # 2. Build a mixed image/PDF-text payload for the LLM.
    human_content = build_document_human_content(
        state.get("files", []),
        (
            "Extract all rubric criteria from these documents. "
            "Use the EXACT JSON schema specified in the system prompt: "
            "criteria items must use 'points' and 'description' fields (NOT 'mark', 'point', 'for', or 'marks_total'). "
            "penalties items must use 'deduction' and 'condition' fields. "
            "Wrap all mathematical expressions in LaTeX dollar signs ($...$)."
        ),
    )
            
    # 3. Wrap everything inside a single HumanMessage and send it to the AI
    messages.append(HumanMessage(content=human_content))

    # Strict JSON formatting constraint
    json_llm = llm.bind(response_format={"type": "json_object"})
    response = json_llm.invoke(messages)

    try:
        # The exact encoding safeguard trick to prevent '\u001e' corruption
        parsed_string = json.loads(response.content)
        final_string_payload = json.dumps(parsed_string, ensure_ascii=False)
    except Exception:
        # Fallback to direct string content if parsing fails
        final_string_payload = response.content
    
    return {"final_output": final_string_payload}
    

# ---------------------------------------------------------
# NODE 2: The Agent Brain (Targeted for Rubrics)
# ---------------------------------------------------------
def save_with_agent(state: AgentState):
    """Decides which tools to call based on the extracted Rubric JSON."""
    
    print("\n" + "="*50)
    print(f"[save_with_agent] 🚀 Entering node.")
    print(f"[save_with_agent] 🔍 State -> teacher_id: {state.get('teacher_id')}, assignment_id: {state.get('assignment_id')}")
    print(f"[save_with_agent] 🔍 Current message count in state: {len(state.get('messages', []))}")
    
    if not state.get("messages"):
        print("[save_with_agent] 🛤️ Branch: FIRST PASS (No previous messages).")
        
        raw_json_string = state.get("final_output", "{}")
        parsed_data = json.loads(raw_json_string)
        
        # 🚨 RUBRIC-SPECIFIC TARGETING: Extract the "rubrics" array instead of "questions"
        rubrics_list = _dedupe_rubrics_by_question_label(parsed_data.get("rubrics", []))
        formatted_rubrics_block = json.dumps(rubrics_list, indent=2)
        
        initial_instruction = system_prompt.format(
            teacher_id=state["teacher_id"],
            assignment_id=state["assignment_id"],
        ) + f"\n\nHere is the exact data array you must loop over and save using the 'insert_rubric' tool:\n{formatted_rubrics_block}"
        
        messages_to_process = [HumanMessage(content=initial_instruction)]
    else:
        print("[save_with_agent] 🛤️ Branch: LOOPING BACK. Using existing message history.")
        messages_to_process = state["messages"]

    print(f"[save_with_agent] 🧠 Invoking LLM with {len(messages_to_process)} messages...")
    
    response = agent_llm.invoke(messages_to_process)

    print(f"[save_with_agent] ✅ LLM Responded.")
    
    if hasattr(response, "tool_calls") and response.tool_calls:
        print(f"[save_with_agent] 🛠️ LLM requested {len(response.tool_calls)} tool calls.")
    else:
        print("[save_with_agent] 🛑 No tool calls requested by LLM. It is finished.")
    
    print("="*50 + "\n")
    
    # Leverages `add_messages` safely
    return {"messages": [response]}
