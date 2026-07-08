import json
from pydantic import BaseModel, Field
from langchain_core.tools import tool
from config.db import get_db_connection


class GetAssignmentLabelsInput(BaseModel):
    teacher_id: str = Field(...)
    assignment_id: int = Field(...)

@tool("get_assignment_labels", args_schema=GetAssignmentLabelsInput)
def get_assignment_labels(teacher_id: str, assignment_id: int) -> str:
    """Fetches all question labels for an assignment."""
    sql = """
        SELECT question_label 
        FROM public.questions 
        WHERE teacher_id = %s AND assignment_id = %s
        ORDER BY id ASC;
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (teacher_id, assignment_id))
                rows = cur.fetchall()
                labels = [row['question_label'] for row in rows]
                if not labels:
                    return json.dumps({"message": "No questions found for this assignment."})
                return json.dumps({"labels": labels})
    except Exception as e:
        return json.dumps({"error": f"Database error fetching labels: {str(e)}"})


class FetchContextInput(BaseModel):
    teacher_id: str = Field(...)
    student_id: str = Field(...)
    assignment_id: int = Field(...)
    question_label: str = Field(...)

@tool("fetch_evaluation_context", args_schema=FetchContextInput)
def fetch_evaluation_context(teacher_id: str, student_id: str, assignment_id: int, question_label: str) -> str:
    """Fetches question, rubric, teacher solution, and student answer for a single question label."""
    sql = """
        SELECT 
            sa.id AS ans_id,
            COALESCE(sa.answer, '') AS answer,
            q.question_description,
            COALESCE(r.rubric_description, '{}'::jsonb) AS rubric_description,
            COALESCE(ts.solution_text, '') AS teacher_solution,
            sqs.marks AS existing_marks,
            sqs.confidence_score AS existing_confidence_score,
            COALESCE(sqs.ai_comment, '') AS existing_ai_comment
        FROM public.questions q
        LEFT JOIN public.student_answers sa
            ON sa.assignment_id = q.assignment_id
            AND sa.teacher_id = q.teacher_id
            AND sa.student_id = %s
            AND regexp_replace(lower(sa.question_label), '\\s+', '', 'g')
                = regexp_replace(lower(q.question_label), '\\s+', '', 'g')
        LEFT JOIN public.rubrics r 
            ON r.assignment_id = q.assignment_id 
            AND r.teacher_id = q.teacher_id
            AND regexp_replace(lower(r.question_label), '\\s+', '', 'g')
                = regexp_replace(lower(q.question_label), '\\s+', '', 'g')
        LEFT JOIN public.teacher_solutions ts 
            ON ts.assignment_id = q.assignment_id 
            AND ts.teacher_id = q.teacher_id
            AND regexp_replace(lower(ts.question_label), '\\s+', '', 'g')
                = regexp_replace(lower(q.question_label), '\\s+', '', 'g')
        LEFT JOIN public.student_question_scores sqs
            ON sqs.assignment_id = q.assignment_id
            AND sqs.teacher_id = q.teacher_id
            AND sqs.student_id = %s
            AND regexp_replace(lower(sqs.question_label), '\\s+', '', 'g')
                = regexp_replace(lower(q.question_label), '\\s+', '', 'g')
            AND (
                sa.answer IS NULL
                OR sqs.student_solution IS NULL
                OR sa.answer = sqs.student_solution
            )
        WHERE q.teacher_id = %s 
            AND q.assignment_id = %s 
            AND regexp_replace(lower(q.question_label), '\\s+', '', 'g')
                = regexp_replace(lower(%s), '\\s+', '', 'g')
        ORDER BY sa.created_at DESC NULLS LAST, sqs.updated_at DESC NULLS LAST
        LIMIT 1;
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (student_id, student_id, teacher_id, assignment_id, question_label))
                row = cur.fetchone()
                if not row:
                    return json.dumps({"error": f"No matching data found for label '{question_label}'."})
                return json.dumps({
                    "student_answer_id": row['ans_id'],
                    "question_description": row['question_description'],
                    "rubric_description": row['rubric_description'],
                    "student_answer": row['answer'],
                    "teacher_solution": row['teacher_solution'],
                    "existing_marks": float(row['existing_marks']) if row['existing_marks'] is not None else None,
                    "existing_confidence_score": float(row['existing_confidence_score']) if row['existing_confidence_score'] is not None else None,
                    "existing_ai_comment": row['existing_ai_comment'] or "",
                })
    except Exception as e:
        return json.dumps({"error": f"Database error: {str(e)}"})


class SaveScoreInput(BaseModel):
    teacher_id: str = Field(...)
    student_id: str = Field(...)
    assignment_id: int = Field(...)
    question_label: str = Field(...)
    student_solution: str = Field(...)
    marks: float = Field(...)
    confidence_score: float = Field(...)
    ai_comment: str = Field(default="", description="AI-generated comment about student weakness")

@tool("save_student_score", args_schema=SaveScoreInput)
def save_student_score(teacher_id: str, student_id: str, assignment_id: int, question_label: str, student_solution: str, marks: float, confidence_score: float, ai_comment: str = "") -> str:
    """Saves or updates the student's score for a question in student_question_scores table."""
    update_sql = """
        UPDATE public.student_question_scores
        SET
            marks = %s,
            confidence_score = %s,
            student_solution = %s,
            ai_comment = %s,
            updated_at = now()
        WHERE id = (
            SELECT id
            FROM public.student_question_scores
            WHERE teacher_id = %s
              AND student_id = %s
              AND assignment_id = %s
              AND regexp_replace(lower(question_label), '\\s+', '', 'g')
                    = regexp_replace(lower(%s), '\\s+', '', 'g')
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 1
        )
        RETURNING id;
    """
    insert_sql = """
        INSERT INTO public.student_question_scores 
            (teacher_id, student_id, assignment_id, question_label, student_solution, marks, confidence_score, ai_comment)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id;
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    update_sql,
                    (marks, confidence_score, student_solution, ai_comment, teacher_id, student_id, assignment_id, question_label)
                )
                row = cur.fetchone()
                if row:
                    new_id = row['id']
                else:
                    cur.execute(
                        insert_sql,
                        (teacher_id, student_id, assignment_id, question_label, student_solution, marks, confidence_score, ai_comment)
                    )
                    new_id = cur.fetchone()['id']
                conn.commit()
        print(f"[save_student_score] Saved score for {question_label} (id={new_id})")
        return f"Successfully saved score for '{question_label}'. ID: {new_id}"
    except Exception as e:
        print(f"[save_student_score] Error: {e}")
        return f"Database error saving score: {str(e)}"


tools = [fetch_evaluation_context, get_assignment_labels, save_student_score]
tools_by_name = {tool_item.name: tool_item for tool_item in tools}
