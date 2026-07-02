from typing import TypedDict, Optional, List, Annotated
import operator

class AssignmentState(TypedDict):
    # Inputs
    teacher_id: str
    student_id: str
    assignment_id: int
    pending_labels: List[str]
    current_label: Optional[str]

    # Fetched from DB
    student_answer_id: Optional[int]
    question_description: Optional[str]
    rubric_description: Optional[str]
    student_answer: Optional[str]
    teacher_solution: Optional[str]
    existing_marks: Optional[float]
    existing_confidence_score: Optional[float]
    existing_ai_comment: Optional[str]

    # AI Outputs
    grader_1_result: Optional[dict]
    grader_2_result: Optional[dict]
    weakness_result: Optional[dict]

    # Accumulated results
    all_results: Annotated[list, operator.add]
