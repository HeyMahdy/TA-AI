import json
from .tools import get_assignment_labels, fetch_evaluation_context, save_student_score
from .state import AssignmentState
from .prompt import grader_1_prompt, grader_2_prompt, weakness_prompt
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field


class GraderOutput(BaseModel):
    score: float = Field(description="The numeric score awarded based on the rubric criteria.")


class WeaknessOutput(BaseModel):
    comment: str = Field(description="A concise comment identifying the student's weakness or misconception for this question.")


llm_grader_1 = ChatOpenAI(model="gpt-5.4-mini", temperature=0)
structured_grader_1 = llm_grader_1.with_structured_output(GraderOutput)

llm_grader_2 = ChatOpenAI(model="gpt-5.4-mini", temperature=0)
structured_grader_2 = llm_grader_2.with_structured_output(GraderOutput)

llm_weakness = ChatOpenAI(model="gpt-5.4-mini", temperature=0.3)
structured_weakness = llm_weakness.with_structured_output(WeaknessOutput)

def _extract_rubric_max_points(rubric_description: str) -> float | None:
    """Parse rubric JSON and return total points from criteria if available."""
    try:
        data = json.loads(rubric_description) if isinstance(rubric_description, str) else rubric_description
        criteria = data.get("criteria", []) if isinstance(data, dict) else []
        total = 0.0
        for item in criteria:
            points = item.get("points", 0) if isinstance(item, dict) else 0
            total += float(points)
        return total if total > 0 else None
    except Exception:
        return None


def _normalize_score(score: float, rubric_max: float | None) -> float:
    """Clamp score to valid range and round consistently."""
    normalized = max(0.0, float(score))
    if rubric_max is not None:
        normalized = min(normalized, rubric_max)
    return round(normalized, 2)


def init_supervisor_node(state: AssignmentState):
    """Fetches ALL question labels for the assignment and creates the queue."""
    print("[init_supervisor] Initializing assignment queue...")

    result_str = get_assignment_labels.invoke({
        "teacher_id": state["teacher_id"],
        "assignment_id": state["assignment_id"]
    })

    print(f"[init_supervisor] Labels result: {result_str}")

    data = json.loads(result_str)
    labels = data.get("labels", [])

    return {"pending_labels": labels}


def fetch_next_context_node(state: AssignmentState):
    """Pops the next label from the queue and fetches full context from DB."""
    queue = list(state.get("pending_labels", []))
    next_label = queue.pop(0)
    print(f"\n[fetch_next_context] Processing question: {next_label}")

    result_str = fetch_evaluation_context.invoke({
        "teacher_id": state["teacher_id"],
        "student_id": state["student_id"],
        "assignment_id": state["assignment_id"],
        "question_label": next_label
    })

    print(f"[fetch_next_context] Context fetched for {next_label}")

    data = json.loads(result_str)

    if "error" in data:
        print(f"[fetch_next_context] ERROR: {data['error']}")
        return {
            "pending_labels": queue,
            "current_label": next_label,
            "student_answer_id": None,
            "question_description": "",
            "rubric_description": "{}",
            "student_answer": "",
            "teacher_solution": "",
        }

    return {
        "pending_labels": queue,
        "current_label": next_label,
        "student_answer_id": data["student_answer_id"],
        "question_description": data["question_description"],
        "rubric_description": json.dumps(data["rubric_description"]) if isinstance(data["rubric_description"], dict) else str(data["rubric_description"]),
        "student_answer": data["student_answer"],
        "teacher_solution": data.get("teacher_solution", ""),
        "existing_marks": data.get("existing_marks"),
        "existing_confidence_score": data.get("existing_confidence_score"),
        "existing_ai_comment": data.get("existing_ai_comment", ""),
    }


def grader_1_node(state: AssignmentState):
    """Strict grader evaluation."""
    print(f"  -> [Grader 1] Evaluating {state.get('current_label')}...")

    existing_marks = state.get("existing_marks")
    if existing_marks is not None:
        print(f"  -> [Grader 1] Reusing existing score: {existing_marks}")
        return {"grader_1_result": {"score": float(existing_marks)}}

    if not state.get("student_answer"):
        return {"grader_1_result": {"score": 0.0}}

    messages = grader_1_prompt.format_messages(
        question_description=state["question_description"],
        rubric_description=state["rubric_description"],
        teacher_solution=state.get("teacher_solution", "Not provided"),
        student_answer=state["student_answer"]
    )

    result = structured_grader_1.invoke(messages)
    rubric_max = _extract_rubric_max_points(state.get("rubric_description", "{}"))
    score = _normalize_score(result.score, rubric_max)

    print(f"  -> [Grader 1] Score: {score}")
    return {"grader_1_result": {"score": score}}


def grader_2_node(state: AssignmentState):
    """Fair grader evaluation."""
    print(f"  -> [Grader 2] Evaluating {state.get('current_label')}...")

    existing_marks = state.get("existing_marks")
    if existing_marks is not None:
        print(f"  -> [Grader 2] Reusing existing score: {existing_marks}")
        return {"grader_2_result": {"score": float(existing_marks)}}

    if not state.get("student_answer"):
        return {"grader_2_result": {"score": 0.0}}

    messages = grader_2_prompt.format_messages(
        question_description=state["question_description"],
        rubric_description=state["rubric_description"],
        teacher_solution=state.get("teacher_solution", "Not provided"),
        student_answer=state["student_answer"]
    )

    result = structured_grader_2.invoke(messages)
    rubric_max = _extract_rubric_max_points(state.get("rubric_description", "{}"))
    score = _normalize_score(result.score, rubric_max)

    print(f"  -> [Grader 2] Score: {score}")
    return {"grader_2_result": {"score": score}}


def weakness_analyzer_node(state: AssignmentState):
    """Analyzes student weakness — does NOT grade, only comments."""
    print(f"  -> [Weakness Analyzer] Analyzing {state.get('current_label')}...")

    if state.get("existing_marks") is not None and state.get("existing_ai_comment"):
        existing_comment = str(state.get("existing_ai_comment", "")).strip()
        print("  -> [Weakness Analyzer] Reusing existing comment")
        return {"weakness_result": {"comment": existing_comment}}

    if not state.get("student_answer"):
        return {"weakness_result": {"comment": "No answer provided by student."}}

    messages = weakness_prompt.format_messages(
        question_description=state["question_description"],
        rubric_description=state["rubric_description"],
        teacher_solution=state.get("teacher_solution", "Not provided"),
        student_answer=state["student_answer"]
    )

    result = structured_weakness.invoke(messages)

    print(f"  -> [Weakness Analyzer] Comment: {result.comment[:80]}...")
    return {"weakness_result": {"comment": result.comment}}


def aggregate_results_node(state: AssignmentState):
    """Aggregates grader scores + weakness comment, calculates confidence, saves to DB."""
    label = state["current_label"]
    g1_score = state["grader_1_result"]["score"]
    g2_score = state["grader_2_result"]["score"]
    ai_comment = state.get("weakness_result", {}).get("comment", "")

    # Calculate final score (best of both graders)
    rubric_max = _extract_rubric_max_points(state.get("rubric_description", "{}"))
    final_score = _normalize_score(max(g1_score, g2_score), rubric_max)

    # Calculate confidence based on agreement between graders
    score_diff = abs(g1_score - g2_score)
    max_possible = max(g1_score, g2_score, 1)
    confidence = round(max(0, 1.0 - (score_diff / max_possible)), 2)
    if state.get("existing_marks") is not None and state.get("existing_confidence_score") is not None:
        confidence = round(float(state["existing_confidence_score"]), 2)

    confidence_label = "high" if confidence >= 0.8 else "medium" if confidence >= 0.5 else "low"

    print(f"  -> [Aggregate] {label}: G1={g1_score}, G2={g2_score}, Final={final_score}, Confidence={confidence} ({confidence_label})")

    # Save to database (now includes ai_comment)
    save_student_score.invoke({
        "teacher_id": state["teacher_id"],
        "student_id": state["student_id"],
        "assignment_id": state["assignment_id"],
        "question_label": label,
        "student_solution": state.get("student_answer", ""),
        "marks": final_score,
        "confidence_score": confidence,
        "ai_comment": ai_comment,
    })

    combined_result = {
        "label": label,
        "grader_1_score": g1_score,
        "grader_2_score": g2_score,
        "final_score": final_score,
        "confidence": confidence,
        "confidence_label": confidence_label,
        "ai_comment": ai_comment,
    }

    return {"all_results": [combined_result]}


# --- ROUTING LOGIC ---

def supervisor_router(state: AssignmentState):
    """Checks if there are more questions in the queue."""
    if len(state.get("pending_labels", [])) > 0:
        return "fetch_next"
    else:
        print("\n[Supervisor] Queue empty. Grading complete!")
        return "END"
