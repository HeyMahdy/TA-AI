import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { pool } from '../lib/database.js';

/**
 * Upload and process student answer files via FastAPI Agent layer
 */
export const uploadStudentAnswers = async (req: Request, res: Response) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { is_handwritten } = req.body;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const files = (req as any).files as any[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No answer files uploaded' });
    }

    // Prepare the form data to send to FastAPI
    const formData = new FormData();

    files.forEach((file: any) => {
      formData.append('files', file.buffer, file.originalname);
    });

    formData.append('is_handwritten', String(is_handwritten));
    formData.append('teacher_id', teacherId);
    formData.append('student_id', studentId);
    formData.append('assignment_id', assignmentId);

    const FASTAPI_URL = 'http://localhost:8000';

    const response = await axios.post(`${FASTAPI_URL}/internal/agent/student-answers/process`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    const agentResult = response.data;

    return res.status(200).json({
      message: 'Student answers processed successfully',
      data: agentResult.analysis
    });

  } catch (error: any) {
    console.error('Error communicating with Student Answer Agent service:', error.message);
    return res.status(500).json({
      error: 'Failed to process student answer document',
      details: error.response?.data || error.message
    });
  }
};

/**
 * Get all answers for a student on a specific assignment
 */
export const getStudentAnswersByAssignment = async (req: Request, res: Response) => {
  try {
    const { assignmentId, studentId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const query = `
      SELECT id, question_label, answer, created_at
      FROM public.student_answers
      WHERE assignment_id = $1 AND student_id = $2 AND teacher_id = $3
      ORDER BY id ASC;
    `;

    const result = await pool.query(query, [assignmentId, studentId, teacherId]);

    return res.status(200).json({
      message: 'Student answers retrieved successfully',
      count: result.rowCount ?? (result.rows ? result.rows.length : 0),
      data: result.rows
    });

  } catch (error: any) {
    console.error('Error fetching student answers:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};

/**
 * Update a student answer by ID
 */
export const updateStudentAnswerById = async (req: Request, res: Response) => {
  try {
    const { answerId } = req.params;
    const { question_label, answer } = req.body;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const setFields: string[] = [];
    const queryValues: any[] = [];
    let paramIndex = 1;

    if (question_label !== undefined && question_label !== null && String(question_label).trim() !== '') {
      setFields.push(`question_label = $${paramIndex++}`);
      queryValues.push(question_label);
    }

    if (answer !== undefined && answer !== null && String(answer).trim() !== '') {
      setFields.push(`answer = $${paramIndex++}`);
      queryValues.push(answer);
    }

    if (setFields.length === 0) {
      const existingQuery = `
        SELECT id, question_label, answer, created_at
        FROM public.student_answers
        WHERE id = $1 AND teacher_id = $2;
      `;
      const fallbackResult = await pool.query(existingQuery, [answerId, teacherId]);

      if (!fallbackResult.rows || fallbackResult.rows.length === 0) {
        return res.status(404).json({ error: 'Student answer not found' });
      }

      return res.status(200).json({
        message: 'No modifications requested. Answer remained unchanged.',
        data: fallbackResult.rows[0]
      });
    }

    queryValues.push(answerId);
    const answerIdParam = `$${paramIndex++}`;

    queryValues.push(teacherId);
    const teacherIdParam = `$${paramIndex++}`;

    const query = `
      UPDATE public.student_answers
      SET ${setFields.join(', ')}
      WHERE id = ${answerIdParam} AND teacher_id = ${teacherIdParam}
      RETURNING id, question_label, answer, created_at;
    `;

    const result = await pool.query(query, queryValues);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Student answer not found or you are not authorized to modify it'
      });
    }

    return res.status(200).json({
      message: 'Student answer updated successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error updating student answer:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};
