# Design Document: Teacher Solutions Upload

## Overview

The Teacher Solutions Upload feature enables teachers to upload solution documents (images/PDFs) for assignments, extract solution text using OCR/vision AI, and manage these solutions through retrieval and update operations. This feature follows the exact architectural pattern established by the existing questions and rubrics implementations.

### Purpose

This feature provides teachers with the ability to:
- Upload multiple solution document files (up to 10 images or PDFs) for an assignment
- Automatically extract solution text with question labels using vision AI
- Retrieve all solutions for a specific assignment
- Update existing solution records (question labels and solution text)

### Scope

**In Scope:**
- Solution document upload with multi-file support
- Vision AI-powered OCR extraction of solution text
- Database persistence of solution records
- Solution retrieval filtered by teacher identity and assignment
- Solution record updates with partial field support
- JWT-based authentication and authorization
- Error handling and validation

**Out of Scope:**
- Solution document versioning or history tracking
- Solution sharing between teachers
- Solution templates or pre-filled content
- Batch deletion of solutions
- Solution export functionality

### Key Design Decisions

1. **Architectural Consistency**: Follow the exact pattern of questions and rubrics implementations (Backend Controller → Agent Service → Database)
2. **Vision Model Selection**: Use gpt-4o for complex OCR tasks requiring mathematical notation and structured extraction
3. **File Processing**: Reuse parse_standard_file utility for consistent file handling across all upload features
4. **Database Schema**: Use existing teacher_solutions table with teacher_id, assignment_id, question_label, solution_text
5. **Authentication**: Apply JWT middleware to all routes with teacher identity verification
6. **LangGraph Workflow**: Implement extract_node → save_agent → tool_node pattern with conditional routing


## Architecture

### High-Level Architecture

The Teacher Solutions Upload feature follows a three-tier architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  (Frontend sends multipart/form-data with files + metadata)     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend Layer (Node.js/TypeScript)           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  solutionController.ts                                    │  │
│  │  - uploadSolutions()                                      │  │
│  │  - getSolutionsByAssignment()                             │  │
│  │  - updateSolutionById()                                   │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                          │
│  ┌────────────────────▼─────────────────────────────────────┐  │
│  │  solution.ts (Express Router)                            │  │
│  │  - POST /assignments/:assignmentId/solutions/upload      │  │
│  │  - GET /assignments/:assignmentId/solutions              │  │
│  │  - PATCH /assignments/:solutionId/solutions              │  │
│  │  - JWT Middleware (requireAccessToken)                   │  │
│  │  - Multer (memoryStorage, max 10 files)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Agent Layer (Python/FastAPI)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  main.py                                                  │  │
│  │  POST /internal/agent/solutions/process                  │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                          │
│  ┌────────────────────▼─────────────────────────────────────┐  │
│  │  solutions_agent/                                         │  │
│  │  ├── graph.py (LangGraph workflow)                        │  │
│  │  ├── node.py (extract_node, save_with_agent)             │  │
│  │  ├── state.py (AgentState TypedDict)                     │  │
│  │  ├── tools.py (insert_solution tool)                     │  │
│  │  └── prompt.py (SOLUTION_PROMPT, system_prompt)          │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Database Layer (PostgreSQL)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  public.teacher_solutions                                 │  │
│  │  - id (serial, primary key)                               │  │
│  │  - teacher_id (uuid, foreign key)                         │  │
│  │  - assignment_id (integer, foreign key)                   │  │
│  │  - question_label (text)                                  │  │
│  │  - solution_text (text)                                   │  │
│  │  - created_at (timestamp)                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```


### LangGraph Workflow

The agent service implements a stateful LangGraph workflow:

```
START
  │
  ▼
┌─────────────────┐
│  extract_node   │  ← Vision LLM extracts solutions from images/PDFs
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  save_agent     │  ← Decides which tools to call based on extracted JSON
└────────┬────────┘
         │
         ▼
    [should_continue?]
         │
         ├─── "tools" ──→ ┌──────────────┐
         │                │  tool_node   │  ← Executes insert_solution tool
         │                └──────┬───────┘
         │                       │
         │                       └─────────┐
         │                                 │
         └─── "END" ──→ END ←──────────────┘
```

**Workflow Steps:**

1. **extract_node**: 
   - Receives files converted to base64 images via parse_standard_file
   - Uses gpt-4o vision model with SOLUTION_PROMPT
   - Extracts JSON with "solutions" array containing question_label and solution_text
   - Returns final_output with extracted JSON

2. **save_agent**:
   - First pass: Receives extracted JSON and formats instruction for LLM
   - Invokes agent_llm (with tools bound) to decide tool calls
   - Returns messages with tool_calls or completion signal

3. **should_continue**:
   - Checks last message for tool_calls
   - Routes to "tools" if tool_calls exist, otherwise "END"

4. **tool_node**:
   - Executes insert_solution tool for each solution record
   - Returns tool execution results
   - Loops back to save_agent for next iteration


### Component Interaction Flow

**Upload Flow:**

1. Client sends POST request to `/assignments/:assignmentId/solutions/upload` with files
2. Backend Controller (solutionController.uploadSolutions):
   - Validates JWT token and extracts teacher_id
   - Validates files array is not empty
   - Creates FormData with files, teacher_id, assignment_id
   - Forwards to FastAPI at `/internal/agent/solutions/process`
3. Agent Service (main.py):
   - Receives files and metadata
   - Calls parse_standard_file to convert files to base64 images
   - Injects document_type="solution", teacher_id, assignment_id into state
   - Invokes solutions_agent graph
4. Solutions Agent:
   - extract_node: Vision LLM extracts solutions JSON
   - save_agent: Iterates through solutions array
   - tool_node: Calls insert_solution for each record
5. Database:
   - Inserts records into teacher_solutions table
   - Returns new record IDs
6. Response flows back through Agent → Backend → Client

**Retrieval Flow:**

1. Client sends GET request to `/assignments/:assignmentId/solutions`
2. Backend Controller (solutionController.getSolutionsByAssignment):
   - Validates JWT token and extracts teacher_id
   - Queries database with parameterized query
   - Filters by assignment_id AND teacher_id
   - Orders by id ASC
   - Returns records with id, question_label, solution_text, created_at

**Update Flow:**

1. Client sends PATCH request to `/assignments/:solutionId/solutions` with updates
2. Backend Controller (solutionController.updateSolutionById):
   - Validates JWT token and extracts teacher_id
   - Builds dynamic SET clause for non-empty fields
   - Executes UPDATE with WHERE id = $1 AND teacher_id = $2
   - Returns updated record or 404 if not found/unauthorized


## Components and Interfaces

### Backend Layer Components

#### solutionController.ts

**Purpose**: Handles HTTP requests for solution operations and communicates with Agent Service

**Functions:**

1. **uploadSolutions(req: Request, res: Response)**
   - **Input**: 
     - req.params.assignmentId: string
     - req.authUser.id: uuid (from JWT middleware)
     - req.files: array of uploaded files (via multer)
   - **Output**: 
     - 200: { message: string, data: analysis }
     - 400: { error: "No solution files uploaded" }
     - 500: { error: string, details: string }
   - **Logic**:
     - Extract assignmentId from params
     - Extract teacherId from req.authUser.id
     - Validate files array is not empty
     - Create FormData with files, teacher_id, assignment_id
     - POST to http://localhost:8000/internal/agent/solutions/process
     - Return agent response or error

2. **getSolutionsByAssignment(req: Request, res: Response)**
   - **Input**:
     - req.params.assignmentId: string
     - req.authUser.id: uuid (from JWT middleware)
   - **Output**:
     - 200: { message: string, count: number, data: SolutionRecord[] }
     - 401: { error: "Unauthorized: Missing teacher identity" }
     - 500: { error: string, details: string }
   - **Logic**:
     - Validate teacherId exists
     - Query: SELECT id, question_label, solution_text, created_at FROM teacher_solutions WHERE assignment_id = $1 AND teacher_id = $2 ORDER BY id ASC
     - Return results with count

3. **updateSolutionById(req: Request, res: Response)**
   - **Input**:
     - req.params.solutionId: string
     - req.body.question_label?: string
     - req.body.solution_text?: string
     - req.authUser.id: uuid (from JWT middleware)
   - **Output**:
     - 200: { message: string, data: SolutionRecord }
     - 401: { error: "Unauthorized: Missing teacher identity" }
     - 404: { error: "Solution not found or you are not authorized to modify it" }
     - 500: { error: string, details: string }
   - **Logic**:
     - Build dynamic SET clause for non-empty fields
     - If no fields to update, return existing record
     - Execute UPDATE WHERE id = $1 AND teacher_id = $2
     - Return updated record or 404


#### solution.ts (Express Router)

**Purpose**: Defines routes and middleware for solution operations

**Routes:**

```typescript
import { Router } from 'express';
import multer from 'multer';
import { uploadSolutions, getSolutionsByAssignment, updateSolutionById } from '../controllers/solutionController.js';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';

const upload = multer({ storage: multer.memoryStorage() });
export const solutionRouter = Router();

// Apply JWT authentication to all routes
solutionRouter.use(requireAccessToken);

// Upload solutions (max 10 files)
solutionRouter.post(
  '/assignments/:assignmentId/solutions/upload',
  upload.array('files', 10),
  uploadSolutions
);

// Get solutions by assignment
solutionRouter.get('/assignments/:assignmentId/solutions', getSolutionsByAssignment);

// Update solution by ID
solutionRouter.patch('/assignments/:solutionId/solutions', updateSolutionById);
```

**Middleware:**
- **requireAccessToken**: Validates JWT token and injects req.authUser with teacher identity
- **multer**: Handles multipart/form-data file uploads with memoryStorage


### Agent Layer Components

#### main.py (FastAPI Endpoint)

**Purpose**: Exposes internal endpoint for solution processing

**Endpoint:**

```python
@app.post("/internal/agent/solutions/process")
async def process_solution_endpoint(
    files: list[UploadFile] = File(...),
    teacher_id: str = Form(...),
    assignment_id: int = Form(...),
):
    """
    Internal endpoint for processing multiple solution uploads at once.
    All incoming files go directly to the vision agent via parse_standard_file.
    """
    try:
        # 1. Collect file data
        all_file_contents = []
        all_content_types = []
        
        for file in files:
            contents = await file.read()
            all_file_contents.append(contents)
            all_content_types.append(file.content_type)

        # 2. Parse all files for vision LLM
        initial_state = await parse_standard_file(all_file_contents, all_content_types)
        
        # 3. Inject metadata
        initial_state["document_type"] = "solution"
        initial_state["teacher_id"] = teacher_id
        initial_state["assignment_id"] = assignment_id
        
        # 4. Invoke solutions agent graph
        result = solutions_graph.invoke(initial_state)

        # 5. Return batched response
        return {
            "method_used": "agent_direct_process",
            "files_processed": [f.filename for f in files],
            "analysis": result["final_output"]
        }

    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"{e.__class__.__name__}: {e}")
```


#### solutions_agent/graph.py

**Purpose**: Defines and compiles the LangGraph workflow

```python
from langgraph.graph import StateGraph, START, END
from .state import AgentState
from .node import dynamic_extract_node, save_with_agent, tool_node

def should_continue(state: AgentState):
    """Evaluates the last message to decide the next step."""
    messages = state.get("messages")
    if messages:
        last_message = messages[-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            print(f" -> Agent calling {len(last_message.tool_calls)} tools...")
            return "tools"
    print(" -> Agent finished processing.")
    return "END"

def build_solutions_graph():
    """Builds and compiles the Solutions StateGraph."""
    workflow = StateGraph(AgentState)
    
    workflow.add_node("extract_node", dynamic_extract_node)
    workflow.add_node("tool_node", tool_node)
    workflow.add_node("save_agent", save_with_agent)
    
    # Sequence
    workflow.add_edge(START, "extract_node")
    workflow.add_edge("extract_node", "save_agent")
    
    # Conditional Routing
    workflow.add_conditional_edges(
        "save_agent",
        should_continue,
        {
            "tools": "tool_node",
            "END": END
        }
    )
    
    # Loop Back
    workflow.add_edge("tool_node", "save_agent")
    
    return workflow.compile()
```


#### solutions_agent/node.py

**Purpose**: Implements LangGraph nodes for extraction and saving

```python
import json
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import ToolNode
from .prompt import SOLUTION_PROMPT, system_prompt
from .state import AgentState
from .tools import tools

# Initialize LLMs
llm = ChatOpenAI(model="gpt-4o", temperature=0)
agent_llm = llm.bind_tools(tools)

# Tool Node
tool_node = ToolNode(tools)

def dynamic_extract_node(state: AgentState):
    """Extracts solution text using the vision model."""
    
    messages = [SystemMessage(content=SOLUTION_PROMPT)]
    
    # Build image payload for vision LLM
    human_content = [
        {
            "type": "text",
            "text": "Please transcribe and extract solution text with question labels from these documents."
        }
    ]

    if "files" in state and state["files"]:
        for item in state["files"]:
            image_data_url = item["content"]
            human_content.append({
                "type": "image_url",
                "image_url": {"url": image_data_url}
            })
    
    messages.append(HumanMessage(content=human_content))

    # Enforce JSON output
    json_llm = llm.bind(response_format={"type": "json_object"})
    response = json_llm.invoke(messages)

    try:
        parsed_string = json.loads(response.content)
        final_string_payload = json.dumps(parsed_string, ensure_ascii=False)
    except Exception:
        final_string_payload = response.content
    
    return {"final_output": final_string_payload}
```


```python
def save_with_agent(state: AgentState):
    """Decides which tools to call based on the extracted Solution JSON."""
    
    print("\n" + "="*50)
    print(f"[save_with_agent] 🚀 Entering node.")
    print(f"[save_with_agent] 🔍 State -> teacher_id: {state.get('teacher_id')}, assignment_id: {state.get('assignment_id')}")
    
    if not state.get("messages"):
        print("[save_with_agent] 🛤️ Branch: FIRST PASS (No previous messages).")
        
        raw_json_string = state.get("final_output", "{}")
        parsed_data = json.loads(raw_json_string)
        
        # Extract "solutions" array
        solutions_list = parsed_data.get("solutions", [])
        formatted_solutions_block = json.dumps(solutions_list, indent=2)
        
        initial_instruction = system_prompt.format(
            teacher_id=state["teacher_id"],
            assignment_id=state["assignment_id"],
        ) + f"\n\nHere is the exact data array you must loop over and save using the 'insert_solution' tool:\n{formatted_solutions_block}"
        
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
    
    return {"messages": [response]}
```


#### solutions_agent/state.py

**Purpose**: Defines the state structure for the LangGraph workflow

```python
from typing import TypedDict, Annotated
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    files: list                # List of file objects with content and type
    file_type: str             # "batch_mix" for multiple files
    document_type: str         # "solution" for this agent
    teacher_id: str            # UUID of authenticated teacher
    assignment_id: int         # Assignment ID from request
    final_output: str          # JSON string with extracted solutions
    messages: Annotated[list[BaseMessage], add_messages]  # LangChain messages
```

**State Fields:**
- **files**: List of dictionaries with "content" (base64 image or text) and "type" (image/pdf)
- **file_type**: Always "batch_mix" for multi-file uploads
- **document_type**: Always "solution" for this agent
- **teacher_id**: UUID extracted from JWT token
- **assignment_id**: Integer from URL parameter
- **final_output**: JSON string with "solutions" array
- **messages**: LangChain message history with add_messages reducer


#### solutions_agent/tools.py

**Purpose**: Defines LangChain tools for database operations

```python
import json
from typing import Any
from pydantic import BaseModel, Field
from langchain_core.tools import tool
from config.db import get_db_connection

class InsertSolutionInput(BaseModel):
    teacher_id: str = Field(...)
    assignment_id: int = Field(...)
    question_label: str = Field(..., description="E.g., '1a', 'Q2'")
    solution_text: str = Field(..., description="The solution text for this question")

@tool("insert_solution", args_schema=InsertSolutionInput)
def insert_solution(teacher_id: str, assignment_id: int, question_label: str, solution_text: str) -> str:
    """Saves a new solution for an assignment into the database."""
    sql = """
        INSERT INTO public.teacher_solutions (teacher_id, assignment_id, question_label, solution_text)
        VALUES (%s, %s, %s, %s) RETURNING id;
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (teacher_id, assignment_id, question_label, solution_text))
                new_id = cur.fetchone()['id']
                conn.commit()
        print(f"[insert_solution] Inserted {question_label} (id={new_id})")
        return f"Successfully inserted solution '{question_label}'. ID: {new_id}"
    except Exception as e:
        print(f"[insert_solution] Error: {e}")
        return f"Database error inserting solution: {str(e)}"

tools = [insert_solution]
tools_by_name = {tool_item.name: tool_item for tool_item in tools}
```

**Tool Details:**
- **Name**: insert_solution
- **Input Schema**: InsertSolutionInput with teacher_id, assignment_id, question_label, solution_text
- **Database Operation**: INSERT INTO teacher_solutions with parameterized query
- **Return**: Success message with new record ID or error message


#### solutions_agent/prompt.py

**Purpose**: Defines prompts for vision extraction and database routing

```python
SOLUTION_PROMPT = """
You are an expert OCR transcriber for academic solution documents. Your job is to extract solution text with question labels from the provided document pages and output them in strict JSON format.

CRITICAL RULES:
1. EXTRACT EVERYTHING: Ensure no solutions or sub-questions are skipped. Loop through every solution systematically.
2. TRANSCRIPT INTEGRITY: Transcribe the solution text EXACTLY as written on the page.
3. QUESTION LABELS: Extract the question label (e.g., "1a", "Q2", "Problem 3") for each solution.

MATHEMATICAL ENCODING PROTECTION:
To prevent database character encoding corruption, you MUST transcribe all mathematical expressions using clean standard LaTeX syntax wrapped in inline dollar signs ($...$).

Examples:
- For question 1(a): $x^2 + 2x + 1 = (x + 1)^2$
- For question 2(b): $\\forall x \\exists y (x = y^2)$
- For question 3(c): $\\frac{d}{dx}(3x^2 - 5x + 2) = 6x - 5$

Output JSON Schema:
{
  "solutions": [
    {
      "question_label": "1a",
      "solution_text": "The solution is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$. Substituting values..."
    },
    {
      "question_label": "2b",
      "solution_text": "To prove this, we use induction. Base case: when $n = 1$..."
    }
  ]
}
"""

system_prompt = """
You are a precise Database Routing Agent for an automated grading system.
Your sole job is to receive perfectly structured JSON payloads and save them to the database using the correct tools.

RUNTIME CONTEXT:
- Teacher ID: {teacher_id}
- Assignment ID: {assignment_id}

INPUT DETECTION:
You will receive a JSON object with a "solutions" array (e.g., {{"solutions": [...]}}).

INSTRUCTIONS:
1. Iterate through every object in the "solutions" array.
2. For each object, call the `insert_solution` tool.
3. Map:
   - teacher_id="{teacher_id}"
   - assignment_id={assignment_id}
   - question_label = the "question_label" value from the object
   - solution_text = the "solution_text" value from the object

CRITICAL:
- Do not modify or summarize the data.
- You must call the tool EXACTLY once for EVERY SINGLE ITEM in the provided JSON array.
- Once finished, reply with a brief confirmation message.
"""
```


## Data Models

### Database Schema

#### teacher_solutions Table

```sql
CREATE TABLE public.teacher_solutions (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  teacher_id uuid NOT NULL,
  assignment_id integer NOT NULL,
  question_label text NOT NULL,
  solution_text text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT teacher_solutions_teacher_fkey
    FOREIGN KEY (teacher_id)
    REFERENCES public.profiles(id),
  
  CONSTRAINT teacher_solutions_assignment_fkey
    FOREIGN KEY (assignment_id)
    REFERENCES public.assignments(id)
);
```

**Field Descriptions:**
- **id**: Auto-incrementing primary key
- **teacher_id**: UUID foreign key to profiles table (authenticated teacher)
- **assignment_id**: Integer foreign key to assignments table
- **question_label**: Text label for the question (e.g., "1a", "Q2", "Problem 3")
- **solution_text**: Full solution text with mathematical notation in LaTeX format
- **created_at**: Timestamp of record creation

**Indexes:**
```sql
CREATE INDEX idx_teacher_solutions_assignment
ON public.teacher_solutions(assignment_id);

CREATE INDEX idx_teacher_solutions_teacher
ON public.teacher_solutions(teacher_id);
```


### TypeScript Interfaces

```typescript
// Solution record from database
interface SolutionRecord {
  id: number;
  question_label: string;
  solution_text: string;
  created_at: string;
}

// Upload request body
interface UploadSolutionsRequest {
  assignmentId: string;  // From URL params
  files: Express.Multer.File[];  // From multer
  authUser: {
    id: string;  // Teacher UUID from JWT
  };
}

// Get solutions request
interface GetSolutionsRequest {
  assignmentId: string;  // From URL params
  authUser: {
    id: string;  // Teacher UUID from JWT
  };
}

// Update solution request
interface UpdateSolutionRequest {
  solutionId: string;  // From URL params
  question_label?: string;  // Optional update field
  solution_text?: string;  // Optional update field
  authUser: {
    id: string;  // Teacher UUID from JWT
  };
}

// Agent service response
interface AgentResponse {
  method_used: string;
  files_processed: string[];
  analysis: string;  // JSON string with solutions array
}
```


### Python Data Models

```python
# Pydantic models for tool inputs
class InsertSolutionInput(BaseModel):
    teacher_id: str = Field(...)
    assignment_id: int = Field(...)
    question_label: str = Field(..., description="E.g., '1a', 'Q2'")
    solution_text: str = Field(..., description="The solution text for this question")

# Agent state structure
class AgentState(TypedDict):
    files: list                # List of file objects
    file_type: str             # "batch_mix"
    document_type: str         # "solution"
    teacher_id: str            # UUID
    assignment_id: int         # Integer
    final_output: str          # JSON string
    messages: Annotated[list[BaseMessage], add_messages]

# Extracted solution structure (from vision LLM)
class ExtractedSolution(BaseModel):
    question_label: str
    solution_text: str

class ExtractedSolutions(BaseModel):
    solutions: list[ExtractedSolution]
```


## API Specifications

### Backend API Endpoints

#### POST /assignments/:assignmentId/solutions/upload

**Purpose**: Upload solution documents for an assignment

**Authentication**: Required (JWT via requireAccessToken middleware)

**Request:**
- **Method**: POST
- **Content-Type**: multipart/form-data
- **URL Parameters**:
  - assignmentId: string (assignment ID)
- **Form Fields**:
  - files: File[] (up to 10 image or PDF files)
- **Headers**:
  - Authorization: Bearer {jwt_token}

**Response:**

Success (200):
```json
{
  "message": "Solutions processed successfully",
  "data": "{\"solutions\": [{\"question_label\": \"1a\", \"solution_text\": \"...\"}]}"
}
```

Error (400):
```json
{
  "error": "No solution files uploaded"
}
```

Error (401):
```json
{
  "error": "Unauthorized: Missing teacher identity"
}
```

Error (500):
```json
{
  "error": "Failed to process solution document",
  "details": "Error message from agent service"
}
```


#### GET /assignments/:assignmentId/solutions

**Purpose**: Retrieve all solutions for a specific assignment

**Authentication**: Required (JWT via requireAccessToken middleware)

**Request:**
- **Method**: GET
- **URL Parameters**:
  - assignmentId: string (assignment ID)
- **Headers**:
  - Authorization: Bearer {jwt_token}

**Response:**

Success (200):
```json
{
  "message": "Solutions retrieved successfully",
  "count": 3,
  "data": [
    {
      "id": 1,
      "question_label": "1a",
      "solution_text": "The solution is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$...",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": 2,
      "question_label": "2b",
      "solution_text": "To prove this, we use induction...",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

Empty result (200):
```json
{
  "message": "Solutions retrieved successfully",
  "count": 0,
  "data": []
}
```

Error (401):
```json
{
  "error": "Unauthorized: Missing teacher identity"
}
```

Error (500):
```json
{
  "error": "Database error",
  "details": "Error message"
}
```


#### PATCH /assignments/:solutionId/solutions

**Purpose**: Update an existing solution record

**Authentication**: Required (JWT via requireAccessToken middleware)

**Request:**
- **Method**: PATCH
- **Content-Type**: application/json
- **URL Parameters**:
  - solutionId: string (solution record ID)
- **Headers**:
  - Authorization: Bearer {jwt_token}
- **Body**:
```json
{
  "question_label": "1a (updated)",
  "solution_text": "Updated solution text..."
}
```

**Response:**

Success (200):
```json
{
  "message": "Solution updated successfully",
  "data": {
    "id": 1,
    "question_label": "1a (updated)",
    "solution_text": "Updated solution text...",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

No changes (200):
```json
{
  "message": "No modifications requested. Solution remained unchanged.",
  "data": {
    "id": 1,
    "question_label": "1a",
    "solution_text": "Original solution text...",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

Error (401):
```json
{
  "error": "Unauthorized: Missing teacher identity"
}
```

Error (404):
```json
{
  "error": "Solution not found or you are not authorized to modify it"
}
```

Error (500):
```json
{
  "error": "Database error",
  "details": "Error message"
}
```


### Agent Service API

#### POST /internal/agent/solutions/process

**Purpose**: Internal endpoint for processing solution documents via LangGraph agent

**Authentication**: None (internal service-to-service communication)

**Request:**
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Form Fields**:
  - files: File[] (uploaded solution documents)
  - teacher_id: string (UUID)
  - assignment_id: integer

**Response:**

Success (200):
```json
{
  "method_used": "agent_direct_process",
  "files_processed": ["solution_page1.jpg", "solution_page2.jpg"],
  "analysis": "{\"solutions\": [{\"question_label\": \"1a\", \"solution_text\": \"...\"}]}"
}
```

Error (500):
```json
{
  "detail": "Exception: Error message"
}
```

**Processing Flow:**
1. Receive files and metadata
2. Convert files to base64 images via parse_standard_file
3. Inject metadata into initial state
4. Invoke solutions_graph (LangGraph workflow)
5. Return extracted solutions JSON


## Error Handling

### Backend Error Handling

**Authentication Errors:**
- **401 Unauthorized**: Missing or invalid JWT token
- **401 Unauthorized**: Missing teacher identity in token
- Handled by requireAccessToken middleware

**Validation Errors:**
- **400 Bad Request**: No files uploaded
- **400 Bad Request**: Invalid file types (not image or PDF)
- Handled in controller before forwarding to agent service

**Agent Service Communication Errors:**
- **500 Internal Server Error**: Failed to communicate with FastAPI service
- **500 Internal Server Error**: Agent service returned error response
- Includes error details from agent service in response

**Database Errors:**
- **500 Internal Server Error**: Database query failed
- **500 Internal Server Error**: Connection error
- Includes error message in response details

**Authorization Errors:**
- **404 Not Found**: Solution record not found or belongs to different teacher
- Handled by WHERE clause with teacher_id verification

### Agent Service Error Handling

**File Processing Errors:**
- **400 Bad Request**: Could not extract text from PDF
- **400 Bad Request**: Unsupported file type
- Raised by parse_standard_file utility

**Vision LLM Errors:**
- **500 Internal Server Error**: LLM invocation failed
- **500 Internal Server Error**: JSON parsing failed
- Caught in extract_node with traceback logging

**Database Tool Errors:**
- Tool returns error message string instead of success
- Logged to console with [insert_solution] prefix
- Agent continues processing remaining solutions

**Graph Execution Errors:**
- **500 Internal Server Error**: Graph invocation failed
- Full traceback printed to console
- HTTPException raised with error details


### Error Recovery Strategies

**Partial Upload Failures:**
- If some solutions fail to insert, agent continues processing remaining solutions
- Each tool call is independent and logged separately
- Frontend receives partial success with error details in analysis

**Retry Logic:**
- No automatic retries at backend or agent level
- Client responsible for retrying failed uploads
- Idempotency not guaranteed (duplicate uploads create duplicate records)

**Validation at Multiple Layers:**
1. **Frontend**: File type and size validation before upload
2. **Backend**: Files array validation, JWT validation
3. **Agent**: File parsing validation, JSON schema validation
4. **Database**: Foreign key constraints, NOT NULL constraints

**Logging Strategy:**
- Backend: Console.error for all caught exceptions
- Agent: Print statements with emoji prefixes for workflow tracking
- Database: PostgreSQL logs for constraint violations


## Testing Strategy

### Unit Testing

**Backend Controller Tests:**
- Test uploadSolutions with valid files and metadata
- Test uploadSolutions with no files (400 error)
- Test uploadSolutions with agent service failure (500 error)
- Test getSolutionsByAssignment with valid teacher_id
- Test getSolutionsByAssignment with no results (empty array)
- Test getSolutionsByAssignment without teacher_id (401 error)
- Test updateSolutionById with valid updates
- Test updateSolutionById with no updates (returns unchanged record)
- Test updateSolutionById with non-existent ID (404 error)
- Test updateSolutionById with different teacher_id (404 error)

**Agent Node Tests:**
- Test dynamic_extract_node with image files
- Test dynamic_extract_node with PDF files
- Test dynamic_extract_node with mixed files
- Test save_with_agent first pass (no messages)
- Test save_with_agent loop back (with messages)
- Test should_continue with tool_calls (returns "tools")
- Test should_continue without tool_calls (returns "END")

**Tool Tests:**
- Test insert_solution with valid inputs
- Test insert_solution with database error
- Test insert_solution with foreign key violation
- Mock get_db_connection for isolated testing


### Integration Testing

**End-to-End Upload Flow:**
1. Create test assignment and teacher account
2. Upload solution files via POST endpoint
3. Verify agent service receives files
4. Verify database records created
5. Verify response contains extracted solutions
6. Clean up test data

**End-to-End Retrieval Flow:**
1. Seed database with solution records
2. Call GET endpoint with assignment_id
3. Verify returned records match seeded data
4. Verify records filtered by teacher_id
5. Verify ordering by id ASC

**End-to-End Update Flow:**
1. Seed database with solution record
2. Call PATCH endpoint with updates
3. Verify database record updated
4. Verify response contains updated data
5. Test authorization (different teacher_id)

**Agent Service Integration:**
- Test FastAPI endpoint with real files
- Test parse_standard_file with various file types
- Test LangGraph workflow execution
- Test database tool execution
- Mock OpenAI API for deterministic testing


### Manual Testing Scenarios

**Scenario 1: Upload Single Solution Document**
1. Login as teacher
2. Navigate to assignment
3. Upload single image with solutions
4. Verify extraction success message
5. Verify solutions appear in database

**Scenario 2: Upload Multiple Solution Documents**
1. Login as teacher
2. Navigate to assignment
3. Upload 5 images with solutions
4. Verify all solutions extracted
5. Verify correct question labels

**Scenario 3: Upload PDF Solution Document**
1. Login as teacher
2. Navigate to assignment
3. Upload PDF with solutions
4. Verify PDF parsed correctly
5. Verify solutions extracted

**Scenario 4: Retrieve Solutions**
1. Login as teacher
2. Navigate to assignment with existing solutions
3. View solutions list
4. Verify all solutions displayed
5. Verify correct ordering

**Scenario 5: Update Solution**
1. Login as teacher
2. Navigate to solution record
3. Edit question_label
4. Edit solution_text
5. Save changes
6. Verify updates persisted

**Scenario 6: Authorization Testing**
1. Login as teacher A
2. Upload solutions for assignment
3. Logout and login as teacher B
4. Attempt to view teacher A's solutions
5. Verify access denied
6. Attempt to update teacher A's solution
7. Verify 404 error

**Scenario 7: Error Handling**
1. Attempt upload without files (verify 400)
2. Attempt upload without authentication (verify 401)
3. Upload corrupted image (verify error message)
4. Update non-existent solution (verify 404)


## Security Considerations

### Authentication and Authorization

**JWT Token Validation:**
- All routes protected by requireAccessToken middleware
- Token must contain valid teacher UUID
- Token expiration enforced by middleware
- Invalid tokens return 401 Unauthorized

**Teacher Identity Verification:**
- Teacher ID extracted from JWT token (req.authUser.id)
- All database queries filtered by teacher_id
- Prevents cross-teacher data access
- UPDATE and DELETE operations verify ownership

**SQL Injection Prevention:**
- All queries use parameterized statements ($1, $2, etc.)
- No string concatenation in SQL queries
- PostgreSQL driver handles escaping
- Example: `WHERE id = $1 AND teacher_id = $2`

### Input Validation

**File Upload Validation:**
- Multer limits to 10 files maximum
- File size limits enforced by multer configuration
- Content-Type validation in parse_standard_file
- Only image/* and application/pdf accepted

**Request Body Validation:**
- Empty string checks for question_label and solution_text
- Trim whitespace before validation
- Type coercion for assignment_id (integer)
- Undefined/null checks for optional fields

**JSON Schema Validation:**
- Vision LLM enforces JSON output format
- Python Pydantic models validate tool inputs
- TypeScript interfaces for type safety
- Database constraints enforce NOT NULL


### Data Protection

**Sensitive Data Handling:**
- Solution text may contain student-identifiable information
- Teacher_id links solutions to specific teachers
- Database access restricted to application service account
- No solution data logged to console (only metadata)

**Database Security:**
- Foreign key constraints enforce referential integrity
- Row-level security via teacher_id filtering
- Connection pooling with credential management
- PostgreSQL SSL connections recommended for production

**API Security:**
- Internal agent endpoint not exposed to public internet
- Backend-to-agent communication over localhost
- CORS configuration restricts allowed origins
- Rate limiting on public endpoints

### Secure Coding Practices

**Error Message Sanitization:**
- Generic error messages to clients
- Detailed errors logged server-side only
- No stack traces in production responses
- Database errors abstracted to "Database error"

**Dependency Security:**
- Regular updates for npm and pip packages
- Security audits via npm audit and pip-audit
- Pinned versions in package.json and pyproject.toml
- Vulnerability scanning in CI/CD pipeline

**Environment Configuration:**
- Secrets stored in .env files (not committed)
- Database credentials in environment variables
- OpenAI API keys in environment variables
- Different configs for dev/staging/production


## Performance Considerations

### File Processing Optimization

**Batch Processing:**
- All files processed in single agent invocation
- Reduces HTTP round-trips between backend and agent
- Vision LLM processes multiple images in one request
- Database inserts executed sequentially (not batched)

**Memory Management:**
- Multer uses memoryStorage for temporary file storage
- Files converted to base64 in memory
- No disk I/O for file uploads
- Memory released after agent processing completes

**Vision LLM Performance:**
- gpt-4o model optimized for vision tasks
- Temperature=0 for deterministic output
- JSON mode reduces parsing overhead
- Single LLM call for extraction (not per-file)

### Database Query Optimization

**Indexed Queries:**
- Index on assignment_id for fast filtering
- Index on teacher_id for authorization checks
- Composite index recommended for (assignment_id, teacher_id)
- ORDER BY id uses primary key index

**Query Efficiency:**
- SELECT only required columns (no SELECT *)
- Parameterized queries cached by PostgreSQL
- Connection pooling reduces connection overhead
- Single query for retrieval (no N+1 problem)

**Update Optimization:**
- Dynamic SET clause only updates changed fields
- Early return if no fields to update
- Single UPDATE query with RETURNING clause
- No separate SELECT after UPDATE


### Scalability Considerations

**Horizontal Scaling:**
- Backend stateless (can run multiple instances)
- Agent service stateless (can run multiple instances)
- Load balancer distributes requests
- Database connection pooling per instance

**Vertical Scaling:**
- Vision LLM calls are CPU/memory intensive
- Consider GPU acceleration for image processing
- Increase agent service memory for large files
- Database tuning for concurrent connections

**Caching Strategy:**
- No caching implemented in initial version
- Future: Cache extracted solutions by file hash
- Future: Cache teacher solutions for assignment
- Future: Redis for distributed caching

**Rate Limiting:**
- Backend rate limiting per teacher
- Prevents abuse of vision LLM API
- Protects database from excessive writes
- Configurable limits per environment

### Monitoring and Observability

**Logging:**
- Backend logs all requests and errors
- Agent logs workflow execution steps
- Database logs slow queries
- Structured logging for analysis

**Metrics:**
- Request count per endpoint
- Response time percentiles
- Vision LLM latency
- Database query duration
- Error rate by type

**Alerting:**
- High error rate alerts
- Vision LLM API failures
- Database connection failures
- Slow query alerts


## Implementation Plan

### Phase 1: Database and Backend Setup

**Tasks:**
1. Verify teacher_solutions table exists with correct schema
2. Create database indexes for performance
3. Create backend/src/controllers/solutionController.ts
4. Implement uploadSolutions function
5. Implement getSolutionsByAssignment function
6. Implement updateSolutionById function
7. Create backend/src/routes/solution.ts
8. Configure multer middleware
9. Apply requireAccessToken middleware
10. Register routes in main app

**Acceptance Criteria:**
- All controller functions compile without errors
- Routes registered and accessible
- JWT middleware applied correctly
- Multer configured for 10 files max

### Phase 2: Agent Service Implementation

**Tasks:**
1. Create agent/utils/solutions_agent/ directory
2. Create state.py with AgentState TypedDict
3. Create tools.py with insert_solution tool
4. Create prompt.py with SOLUTION_PROMPT and system_prompt
5. Create node.py with dynamic_extract_node and save_with_agent
6. Create graph.py with build_solutions_graph
7. Update agent/main.py with /internal/agent/solutions/process endpoint
8. Import and compile solutions_graph in main.py

**Acceptance Criteria:**
- All Python files have no syntax errors
- Graph compiles successfully
- Tool schema validates correctly
- Endpoint accepts multipart/form-data


### Phase 3: Integration and Testing

**Tasks:**
1. Test backend-to-agent communication
2. Test file upload with sample images
3. Test vision LLM extraction
4. Test database insertion
5. Test solution retrieval
6. Test solution update
7. Test authorization (different teachers)
8. Test error handling (no files, invalid files)
9. Write unit tests for controllers
10. Write unit tests for agent nodes
11. Write integration tests for end-to-end flows

**Acceptance Criteria:**
- All manual test scenarios pass
- Unit tests achieve >80% coverage
- Integration tests pass consistently
- Error messages are clear and helpful

### Phase 4: Documentation and Deployment

**Tasks:**
1. Update API documentation with new endpoints
2. Create OpenAPI specs for solution endpoints
3. Update README with solution upload instructions
4. Document environment variables
5. Create deployment guide
6. Configure production environment
7. Deploy backend changes
8. Deploy agent service changes
9. Run smoke tests in production
10. Monitor for errors

**Acceptance Criteria:**
- API documentation complete and accurate
- Deployment guide tested by team member
- Production deployment successful
- No critical errors in first 24 hours


## Future Enhancements

### Version 1.1: Enhanced Features

**Solution Versioning:**
- Track solution history with version numbers
- Allow teachers to view previous versions
- Restore previous versions
- Compare versions side-by-side

**Bulk Operations:**
- Delete multiple solutions at once
- Update multiple solutions with same changes
- Export solutions to PDF or Word
- Import solutions from external sources

**Collaboration:**
- Share solutions with other teachers
- Solution templates library
- Community-contributed solutions
- Solution ratings and reviews

### Version 1.2: Advanced AI Features

**Improved Extraction:**
- Support for handwritten solutions
- Multi-language solution extraction
- Diagram and graph extraction
- Formula recognition improvements

**Solution Analysis:**
- Automatic solution quality scoring
- Completeness checking
- Step-by-step breakdown
- Alternative solution suggestions

**Integration:**
- Link solutions to rubrics automatically
- Generate rubrics from solutions
- Compare student answers to solutions
- Highlight differences

### Version 2.0: Platform Expansion

**Mobile Support:**
- Mobile app for solution upload
- Camera integration for instant capture
- Offline mode with sync
- Push notifications

**Analytics:**
- Solution usage statistics
- Most viewed solutions
- Solution effectiveness metrics
- Teacher productivity insights

**API Enhancements:**
- Webhook support for solution events
- GraphQL API for flexible queries
- Batch API for bulk operations
- Real-time updates via WebSocket

