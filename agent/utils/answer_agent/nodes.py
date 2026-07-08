import json
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import ToolNode

from .prompt import IMAGE_PROMPT, TEXT_PROMPT_PREFIX, JSON_EXTRACTION_PROMPT, system_prompt
from .state import AgentState
from .tools import tools

# Initialize base LLMs
llm = ChatOpenAI(model="gpt-5.4-mini", temperature=0)

# The "Agent" LLM needs to know about the tools!
# This is the crucial step you were missing.
agent_llm_with_tools = llm.bind_tools(tools)

# ---------------------------------------------------------
# NODE 1: The Analyzer (Pre-processing)
# Extracts text from images/PDFs and formats it into JSON.
# ---------------------------------------------------------
def analyze_node(state: AgentState):
    """Extracts data from the document and structures it into JSON."""
    content = state["file_content"]

    # --- Step 1: Transcription ---
    if state["file_type"] == "image":
        message = HumanMessage(
            content=[
                {"type": "text", "text": IMAGE_PROMPT},
                {"type": "image_url", "image_url": {"url": content}},
            ]
        )
    else:
        message = HumanMessage(content=f"{TEXT_PROMPT_PREFIX}{content}")

    transcription_response = llm.invoke([message])
    raw_transcription = transcription_response.content
    

    # --- Step 2: JSON Extraction ---
    json_messages = [
        SystemMessage(content=JSON_EXTRACTION_PROMPT),
        HumanMessage(content=f"Here is the transcribed exam text to parse:\n\n{raw_transcription}")
    ]
    json_llm = llm.bind(response_format={"type": "json_object"})
    json_response = json_llm.invoke(json_messages)
    
    print(json_response)
    
    # We store the final JSON in a specific state variable (e.g., extracted_data)
    # instead of overwriting the generic "messages" array used by the Agent.
    return {"extracted_data": json_response.content}


# ---------------------------------------------------------
# NODE 2: The Agent "Brain" (Decision Maker)
# ---------------------------------------------------------
def decision_agent_node(state: AgentState):
    """
    This is the core agent! It looks at the extracted JSON and decides 
    which tools to call.
    """
    print("[Decision Agent] Thinking...")
    
    # If the agent is just starting, we need to feed it the prompt and the data
    if not state.get("messages"):
        prompt_text = system_prompt.format(
            teacher_id=state["teacher_id"],
            assignment_id=state["assignment_id"],
            student_id=state["student_id"]
        )
        # Combine the prompt rules with the JSON data from the analyze_node
        full_instruction = f"{prompt_text}\n\nDATA TO PROCESS:\n{state['extracted_data']}"
        messages_to_process = [HumanMessage(content=full_instruction)]
        print("[Decision Agent] Input message (first pass):")
        print(messages_to_process[0].content)
    else:
        # If it's looping back from a tool call, it just reads the existing conversation history
        messages_to_process = state["messages"]
        print("[Decision Agent] Input messages (loop):")
        print(messages_to_process)

    # INVOKE THE LLM WITH TOOLS BOUND
    # This is where it generates the tool_calls!
    response = agent_llm_with_tools.invoke(messages_to_process)
    
    # LangGraph expects you to return a dictionary that updates the State.
    # Appending the new message to the conversation history.
    return {"messages": [response]}


# ---------------------------------------------------------
# NODE 3: The Tool Executor
# ---------------------------------------------------------
# LangGraph provides a pre-built node that automatically reads the 
# tool_calls from the LLM's response, executes your python functions, 
# and appends the results to the messages array!
tool_node = ToolNode(tools)