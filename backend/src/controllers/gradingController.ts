import { Request, Response } from 'express';
import axios from 'axios';
import { pool } from '../lib/database.js';

/**
 * Trigger grading for a student's assignment
 */
export const startGrading = async (req: Request, res: Response) => {
  try {
    const { assignmentId, studentId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const FASTAPI_URL = 'http://localhost:8000';

    const response = await axios.post(`${FASTAPI_URL}/internal/agent/grade/process`, {
      teacher_id: teacherId,
      student_id: studentId,
      assignment_id: Number(assignmentId),
    });

    const agentResult = response.data;

    return res.status(200).json({
      message: 'Grading completed successfully',
      data: agentResult.results
    });

  } catch (error: any) {
    console.error('Error communicating with Grading Agent service:', error.message);
    return res.status(500).json({
      error: 'Failed to process grading',
      details: error.response?.data || error.message
    });
  }
};

/**
 * Get grading results for a student on an assignment
 */
export const getGradingResults = async (req: Request, res: Response) => {
  try {
    const { assignmentId, studentId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const query = `
      SELECT id, question_label, student_solution, marks, confidence_score, ai_comment, teacher_comment, created_at, updated_at
      FROM public.student_question_scores
      WHERE assignment_id = $1 AND student_id = $2 AND teacher_id = $3
      ORDER BY id ASC;
    `;

    const result = await pool.query(query, [assignmentId, studentId, teacherId]);

    // Calculate total
    let totalMarks = 0;
    for (const row of result.rows) {
      totalMarks += parseFloat(row.marks);
    }

    return res.status(200).json({
      message: 'Grading results retrieved successfully',
      count: result.rowCount ?? result.rows.length,
      total_marks: totalMarks,
      data: result.rows
    });

  } catch (error: any) {
    console.error('Error fetching grading results:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};

/**
 * Get submitted students for an assignment with total marks obtained
 */
export const getAssignmentSubmittedStudentsScores = async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const assignmentQuery = `
      SELECT id as assignment_id, title, subject, total_marks as assignment_total_marks
      FROM public.assignments
      WHERE id = $1 AND teacher_id = $2;
    `;

    const assignmentResult = await pool.query(assignmentQuery, [assignmentId, teacherId]);

    if (!assignmentResult.rows || assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found or you are not authorized to view it' });
    }

    const submittedStudentsQuery = `
      SELECT
        students.id,
        students.student_id,
        students.name,
        COALESCE(score_totals.marks_obtained, 0)::float as marks_obtained,
        assignments.total_marks as assignment_total_marks,
        submissions.submitted_question_count::int as submitted_question_count,
        COALESCE(score_totals.graded_question_count, 0)::int as graded_question_count,
        submissions.latest_submission_at
      FROM (
        SELECT
          student_id,
          COUNT(DISTINCT question_label)::int as submitted_question_count,
          MAX(created_at) as latest_submission_at
        FROM public.student_answers
        WHERE assignment_id = $1 AND teacher_id = $2
        GROUP BY student_id
      ) submissions
      INNER JOIN public.students
        ON students.id = submissions.student_id
        AND students.teacher_id = $2
      INNER JOIN public.assignments
        ON assignments.id = $1
        AND assignments.teacher_id = $2
      LEFT JOIN (
        SELECT
          student_id,
          SUM(marks)::float as marks_obtained,
          COUNT(*)::int as graded_question_count
        FROM public.student_question_scores
        WHERE assignment_id = $1 AND teacher_id = $2
        GROUP BY student_id
      ) score_totals ON score_totals.student_id = students.id
      ORDER BY students.name ASC;
    `;

    const submittedStudentsResult = await pool.query(submittedStudentsQuery, [assignmentId, teacherId]);

    return res.status(200).json({
      message: 'Assignment submitted students scores retrieved successfully',
      assignment: assignmentResult.rows[0],
      count: submittedStudentsResult.rowCount ?? submittedStudentsResult.rows.length,
      data: submittedStudentsResult.rows
    });

  } catch (error: any) {
    console.error('Error fetching assignment submitted student scores:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};

/**
 * Update a stored grading result after teacher review
 */
export const updateGradingResult = async (req: Request, res: Response) => {
  try {
    const { assignmentId, studentId, scoreId } = req.params;
    const { marks, teacher_comment, comment, comments } = req.body;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const setFields: string[] = [];
    const queryValues: any[] = [];
    let paramIndex = 1;

    if (marks !== undefined && marks !== null && marks !== '') {
      const parsedMarks = Number(marks);

      if (!Number.isFinite(parsedMarks) || parsedMarks < 0) {
        return res.status(400).json({ error: 'marks must be a non-negative number' });
      }

      setFields.push(`marks = $${paramIndex++}`);
      queryValues.push(parsedMarks);
    }

    const commentValue = teacher_comment ?? comment ?? comments;
    if (commentValue !== undefined && commentValue !== null) {
      setFields.push(`teacher_comment = $${paramIndex++}`);
      queryValues.push(String(commentValue));
    }

    if (setFields.length === 0) {
      const existingQuery = `
        SELECT id, question_label, student_solution, marks, confidence_score, teacher_comment, created_at, updated_at
        FROM public.student_question_scores
        WHERE id = $1 AND assignment_id = $2 AND student_id = $3 AND teacher_id = $4;
      `;

      const fallbackResult = await pool.query(existingQuery, [scoreId, assignmentId, studentId, teacherId]);

      if (!fallbackResult.rows || fallbackResult.rows.length === 0) {
        return res.status(404).json({ error: 'Grading result not found' });
      }

      return res.status(200).json({
        message: 'No modifications requested. Grading result remained unchanged.',
        data: fallbackResult.rows[0]
      });
    }

    setFields.push('updated_at = now()');

    queryValues.push(scoreId);
    const scoreIdParam = `$${paramIndex++}`;

    queryValues.push(assignmentId);
    const assignmentIdParam = `$${paramIndex++}`;

    queryValues.push(studentId);
    const studentIdParam = `$${paramIndex++}`;

    queryValues.push(teacherId);
    const teacherIdParam = `$${paramIndex++}`;

    const query = `
      UPDATE public.student_question_scores
      SET ${setFields.join(', ')}
      WHERE id = ${scoreIdParam}
        AND assignment_id = ${assignmentIdParam}
        AND student_id = ${studentIdParam}
        AND teacher_id = ${teacherIdParam}
      RETURNING id, question_label, student_solution, marks, confidence_score, teacher_comment, created_at, updated_at;
    `;

    const result = await pool.query(query, queryValues);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Grading result not found or you are not authorized to modify it'
      });
    }

    return res.status(200).json({
      message: 'Grading result updated successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error updating grading result:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};
