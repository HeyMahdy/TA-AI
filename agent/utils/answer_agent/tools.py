import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Dict, Any
from pydantic import BaseModel, Field
from langchain_core.tools import tool
from dotenv import load_dotenv
from config.db import get_db_connection

from pydantic import BaseModel, Field
from langchain_core.tools import tool

class InsertStudentAnswerInput(BaseModel):
    teacher_id: str = Field(...)
    student_id: str = Field(...)
    assignment_id: int = Field(...)
    question_label: str = Field(...)
    answer: str = Field(..., description="The student's raw extracted answer text")

@tool("insert_student_answer", args_schema=InsertStudentAnswerInput)
def insert_student_answer(teacher_id: str, student_id: str, assignment_id: int, question_label: str, answer: str) -> str:
    """Saves a student's answer for a specific question."""
    sql = """
        INSERT INTO public.student_answers (teacher_id, student_id, assignment_id, question_label, answer) 
        VALUES (%s, %s, %s, %s, %s) RETURNING id;
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (teacher_id, student_id, assignment_id, question_label, answer))
                new_id = cur.fetchone()['id']
                conn.commit()
        return f"Successfully inserted answer for '{question_label}'. ID: {new_id}"
    except Exception as e:
        return f"Database error inserting student answer: {str(e)}"
    
tools = [insert_student_answer]
tools_by_name = {tool_item.name: tool_item for tool_item in tools}


