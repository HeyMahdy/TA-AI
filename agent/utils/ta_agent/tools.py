import json
import os
from contextvars import ContextVar
from typing import List
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field
from langchain_core.tools import tool
from config.db import get_db_connection


AGENT_BASE_URL = "http://localhost:8000"
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8080")
_ta_access_token: ContextVar[str] = ContextVar("ta_access_token", default="")


def set_ta_auth_context(access_token: str = "") -> None:
    _ta_access_token.set(access_token or "")


def _backend_headers() -> dict:
    token = _ta_access_token.get("")
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def _backend_get(path: str) -> str:
    headers = _backend_headers()
    if not headers:
        return json.dumps({"error": "TA context tools need the teacher's authenticated session token."})

    try:
        response = httpx.get(f"{BACKEND_BASE_URL}{path}", headers=headers, timeout=30.0)
        if response.status_code >= 400:
            return json.dumps({"error": response.json().get("error", f"Backend returned {response.status_code}")})
        return json.dumps(response.json())
    except Exception as e:
        return json.dumps({"error": str(e)})


def _backend_get_json(path: str) -> dict:
    return json.loads(_backend_get(path))


def _backend_post(path: str, payload: dict) -> str:
    headers = _backend_headers()
    if not headers:
        return json.dumps({"error": "TA context tools need the teacher's authenticated session token."})

    try:
        response = httpx.post(f"{BACKEND_BASE_URL}{path}", json=payload, headers=headers, timeout=30.0)
        if response.status_code >= 400:
            return json.dumps({"error": response.json().get("error", f"Backend returned {response.status_code}")})
        return json.dumps(response.json())
    except Exception as e:
        return json.dumps({"error": str(e)})


class ResolveEntitiesInput(BaseModel):
    students: List[str] = Field(default_factory=list, description="Student names or teacher-facing student IDs to resolve")
    assignments: List[str] = Field(default_factory=list, description="Assignment titles or assignment IDs to resolve")


@tool("resolve_entities", args_schema=ResolveEntitiesInput)
def resolve_entities(students: List[str] = None, assignments: List[str] = None) -> str:
    """Resolve teacher-friendly student and assignment references using authenticated backend context endpoints."""
    return _backend_post("/ta/context/resolve", {
        "students": students or [],
        "assignments": assignments or [],
    })


class StudentOverviewInput(BaseModel):
    student_ref: str = Field(..., description="Teacher-facing student ID or name-derived resolved student reference")


@tool("get_student_overview", args_schema=StudentOverviewInput)
def get_student_overview(student_ref: str) -> str:
    """Get a student's graded assignment history and summary. Do not ask teachers for UUIDs."""
    return _backend_get(f"/ta/context/students/{quote(student_ref, safe='')}/overview")


class AssignmentOverviewInput(BaseModel):
    assignment_id: int = Field(..., description="Resolved assignment ID from resolve_entities")


@tool("get_assignment_overview", args_schema=AssignmentOverviewInput)
def get_assignment_overview(assignment_id: int) -> str:
    """Get assignment-level class stats, submission counts, grading counts, and syllabus availability."""
    return _backend_get(f"/ta/context/assignments/{assignment_id}/overview")


class StudentAssignmentPerformanceInput(BaseModel):
    student_ref: str = Field(..., description="Resolved student_uuid or teacher-facing student ID from resolve_entities")
    assignment_id: int = Field(..., description="Resolved assignment ID from resolve_entities")


@tool("get_student_assignment_performance", args_schema=StudentAssignmentPerformanceInput)
def get_student_assignment_performance(student_ref: str, assignment_id: int) -> str:
    """Get one student's scores, AI comments, teacher comments, extracted weaknesses, and syllabus availability for one assignment."""
    return _backend_get(f"/ta/context/students/{quote(student_ref, safe='')}/assignments/{assignment_id}/performance")


@tool("get_prerequisite_review_context", args_schema=StudentAssignmentPerformanceInput)
def get_prerequisite_review_context(student_ref: str, assignment_id: int) -> str:
    """Get score-derived weaknesses for one student assignment and query the assignment syllabus for prerequisite review topics."""
    performance = _backend_get_json(
        f"/ta/context/students/{quote(student_ref, safe='')}/assignments/{assignment_id}/performance"
    )
    if performance.get("error"):
        return json.dumps(performance)

    data = performance.get("data", {})
    weaknesses = [item for item in data.get("weaknesses", []) if item]
    scores = data.get("scores", [])

    if weaknesses:
        syllabus_query = "Student weaknesses from grading comments: " + " ".join(weaknesses)
    else:
        low_score_labels = [
            str(score.get("question_label"))
            for score in scores
            if score.get("marks") is not None and float(score.get("marks") or 0) <= 1
        ]
        syllabus_query = "Student struggled on these low-scoring questions: " + ", ".join(low_score_labels)

    prerequisite_result = None
    if scores:
        prerequisite_result = json.loads(query_syllabus.invoke({
            "search_query": syllabus_query,
            "assignment_id": assignment_id,
        }))

    return json.dumps({
        "performance": data,
        "score_derived_weakness_query": syllabus_query if scores else "",
        "syllabus_prerequisites": prerequisite_result,
    })


class AssignmentMistakesInput(BaseModel):
    assignment_id: int = Field(..., description="Resolved assignment ID from resolve_entities")


@tool("get_assignment_mistakes", args_schema=AssignmentMistakesInput)
def get_assignment_mistakes(assignment_id: int) -> str:
    """Get common AI-comment mistake groups for an assignment with affected students shown using friendly identifiers."""
    return _backend_get(f"/ta/context/assignments/{assignment_id}/mistakes")


class StudentWeakConceptsInput(BaseModel):
    student_ref: str = Field(..., description="Teacher-facing student ID or resolved student reference")


@tool("get_student_weak_concepts", args_schema=StudentWeakConceptsInput)
def get_student_weak_concepts(student_ref: str) -> str:
    """Get a student's weak concepts and any existing remediation exercises."""
    return _backend_get(f"/ta/context/students/{quote(student_ref, safe='')}/weak-concepts")


class SearchStudentInput(BaseModel):
    name: str = Field(default="", description="Student name to search for")
    provided_id: str = Field(default="", description="Student ID provided by teacher")
    teacher_id: str = Field(..., description="The teacher's UUID")


@tool("search_student", args_schema=SearchStudentInput)
def search_student(name: str, provided_id: str, teacher_id: str) -> str:
    """Searches the database for a student using their name or ID. Returns the student record."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if provided_id:
                    cur.execute(
                        "SELECT id, student_id, name FROM public.students WHERE teacher_id = %s AND (student_id = %s OR id::text = %s)",
                        (teacher_id, provided_id, provided_id),
                    )
                    row = cur.fetchone()
                    if row:
                        return json.dumps({
                            "student_uuid": str(row["id"]),
                            "student_id": row["student_id"],
                            "name": row["name"],
                        })

                if name:
                    cur.execute(
                        "SELECT id, student_id, name FROM public.students WHERE teacher_id = %s AND LOWER(name) LIKE LOWER(%s) LIMIT 5",
                        (teacher_id, f"%{name}%"),
                    )
                    rows = cur.fetchall()
                    if rows:
                        if len(rows) == 1:
                            return json.dumps({
                                "student_uuid": str(rows[0]["id"]),
                                "student_id": rows[0]["student_id"],
                                "name": rows[0]["name"],
                            })
                        return json.dumps({
                            "multiple_matches": [
                                {
                                    "student_uuid": str(r["id"]),
                                    "student_id": r["student_id"],
                                    "name": r["name"],
                                }
                                for r in rows
                            ]
                        })

                return json.dumps({"error": f"No student found matching name='{name}' or id='{provided_id}'"})
    except Exception as e:
        return json.dumps({"error": str(e)})


class SearchAssignmentInput(BaseModel):
    title: str = Field(..., description="Assignment title or keyword to search for")
    teacher_id: str = Field(..., description="The teacher's UUID")


@tool("search_assignment", args_schema=SearchAssignmentInput)
def search_assignment(title: str, teacher_id: str) -> str:
    """Searches the database for an assignment by title. Returns the assignment record."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, title, subject, total_marks FROM public.assignments WHERE teacher_id = %s AND LOWER(title) LIKE LOWER(%s) LIMIT 5",
                    (teacher_id, f"%{title}%"),
                )
                rows = cur.fetchall()
                if rows:
                    if len(rows) == 1:
                        return json.dumps({
                            "assignment_id": rows[0]["id"],
                            "title": rows[0]["title"],
                            "subject": rows[0]["subject"],
                            "total_marks": rows[0]["total_marks"],
                        })
                    return json.dumps({"multiple_matches": [{"id": r["id"], "title": r["title"]} for r in rows]})
                return json.dumps({"error": f"No assignment found matching '{title}'"})
    except Exception as e:
        return json.dumps({"error": str(e)})


class GetStudentScoresInput(BaseModel):
    assignment_id: int = Field(..., description="The assignment ID")
    student_id: str = Field(..., description="The student ID")
    teacher_id: str = Field(..., description="The teacher's UUID")


@tool("get_student_scores", args_schema=GetStudentScoresInput)
def get_student_scores(assignment_id: int, student_id: str, teacher_id: str) -> str:
    """Fetches the student's grading results including scores and AI comments about weaknesses."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT question_label, marks, confidence_score, ai_comment
                       FROM public.student_question_scores
                       WHERE assignment_id = %s AND student_id = %s AND teacher_id = %s
                       ORDER BY id ASC""",
                    (assignment_id, student_id, teacher_id),
                )
                rows = cur.fetchall()
                if not rows:
                    return json.dumps({"error": "No scores found for this student on this assignment."})

                total = sum(float(r["marks"]) for r in rows)
                results = [
                    {
                        "question_label": r["question_label"],
                        "marks": float(r["marks"]),
                        "confidence": float(r["confidence_score"]),
                        "ai_comment": r.get("ai_comment", ""),
                    }
                    for r in rows
                ]
                return json.dumps({"total_marks": total, "scores": results})
    except Exception as e:
        return json.dumps({"error": str(e)})


class GetStudentAssignmentGradesInput(BaseModel):
    student_id: str = Field(..., description="The teacher-facing student ID, not the student UUID")
    teacher_id: str = Field(..., description="The teacher's UUID")


@tool("get_student_assignment_grades", args_schema=GetStudentAssignmentGradesInput)
def get_student_assignment_grades(student_id: str, teacher_id: str) -> str:
    """Lists all graded assignments for a student with total marks per assignment."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT teacher_id, id, student_id, name, created_at
                       FROM public.students
                       WHERE teacher_id = %s AND student_id = %s""",
                    (teacher_id, student_id),
                )
                student = cur.fetchone()

                if not student:
                    return json.dumps({"error": "Student not found or you are not authorized to view it."})

                cur.execute(
                    """SELECT
                         assignments.id as assignment_id,
                         assignments.title,
                         assignments.subject,
                         assignments.total_marks as assignment_total_marks,
                         score_totals.marks_obtained::float as marks_obtained,
                         score_totals.graded_question_count::int as graded_question_count,
                         assignments.created_at
                       FROM (
                         SELECT
                           assignment_id,
                           SUM(marks)::float as marks_obtained,
                           COUNT(*)::int as graded_question_count
                         FROM public.student_question_scores
                         WHERE teacher_id = %s AND student_id = %s
                         GROUP BY assignment_id
                       ) score_totals
                       INNER JOIN public.assignments
                         ON assignments.id = score_totals.assignment_id
                         AND assignments.teacher_id = %s
                       ORDER BY assignments.created_at DESC""",
                    (teacher_id, student["id"], teacher_id),
                )
                rows = cur.fetchall()

                grades = [
                    {
                        "assignment_id": row["assignment_id"],
                        "title": row["title"],
                        "subject": row["subject"],
                        "assignment_total_marks": float(row["assignment_total_marks"]) if row["assignment_total_marks"] is not None else None,
                        "marks_obtained": float(row["marks_obtained"]),
                        "graded_question_count": int(row["graded_question_count"]),
                        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                    }
                    for row in rows
                ]

                return json.dumps({
                    "student": {
                        "teacher_id": str(student["teacher_id"]),
                        "id": str(student["id"]),
                        "student_id": student["student_id"],
                        "name": student["name"],
                        "created_at": student["created_at"].isoformat() if student["created_at"] else None,
                    },
                    "count": len(grades),
                    "data": grades,
                })
    except Exception as e:
        return json.dumps({"error": str(e)})


class GetAssignmentSubmittedStudentsScoresInput(BaseModel):
    assignment_id: int = Field(..., description="The assignment ID")
    teacher_id: str = Field(..., description="The teacher's UUID")


@tool("get_assignment_submitted_students_scores", args_schema=GetAssignmentSubmittedStudentsScoresInput)
def get_assignment_submitted_students_scores(assignment_id: int, teacher_id: str) -> str:
    """Lists students who submitted answers for an assignment and shows each student's total score."""
    return _backend_get(f"/assignments/{assignment_id}/students/scores")


class QuerySyllabusInput(BaseModel):
    search_query: str = Field(..., description="Natural language query about student weaknesses to find related syllabus topics")
    assignment_id: int = Field(..., description="The assignment ID whose syllabus to query")


@tool("query_syllabus", args_schema=QuerySyllabusInput)
def query_syllabus(search_query: str, assignment_id: int) -> str:
    """Queries the syllabus GraphRAG via the internal API to find prerequisites and related topics based on student weaknesses."""
    try:
        response = httpx.post(
            f"{AGENT_BASE_URL}/internal/agent/syllabus/query",
            json={"query": search_query, "assignment_id": assignment_id},
            timeout=90.0,
        )

        if response.status_code == 404:
            return json.dumps({"error": "No syllabus found for this assignment. Please upload a syllabus first."})

        if response.status_code != 200:
            return json.dumps({"error": f"Syllabus query failed with status {response.status_code}"})

        data = response.json()
        return json.dumps(data)
    except Exception as e:
        return json.dumps({"error": str(e)})


tools = [
    resolve_entities,
    get_student_overview,
    get_assignment_overview,
    get_student_assignment_performance,
    get_prerequisite_review_context,
    get_assignment_mistakes,
    get_student_weak_concepts,
    search_student,
    search_assignment,
    get_student_scores,
    get_student_assignment_grades,
    get_assignment_submitted_students_scores,
    query_syllabus,
]
