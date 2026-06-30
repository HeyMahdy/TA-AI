import { Request, Response } from 'express';
import { pool } from '../lib/database.js';

export const uploadAnswer = async (_req: Request, res: Response) => {
  return res.status(405).json({ error: 'Use the student answer upload endpoint for answer processing' });
};

export const getStudentAnswers = async (req: Request, res: Response) => {
  try {
    const teacherId = req.authUser?.id;
    const { assignmentId, studentId } = req.params;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const result = await pool.query(
      `
        SELECT id, question_label, answer, created_at
        FROM public.student_answers
        WHERE teacher_id = $1 AND assignment_id = $2 AND student_id = $3
        ORDER BY id ASC;
      `,
      [teacherId, assignmentId, studentId],
    );

    return res.status(200).json({
      message: 'Student answers retrieved successfully',
      count: result.rowCount ?? result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching student answers:', error.message);
    return res.status(500).json({ error: 'Database error', details: error.message });
  }
};

export const getExtractedAnswer = async (req: Request, res: Response) => {
  try {
    const teacherId = req.authUser?.id;
    const { answerId } = req.params;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const result = await pool.query(
      `
        SELECT id, question_label, answer, created_at
        FROM public.student_answers
        WHERE teacher_id = $1 AND id = $2;
      `,
      [teacherId, answerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student answer not found' });
    }

    return res.status(200).json({
      message: 'Extracted answer retrieved successfully',
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error fetching extracted answer:', error.message);
    return res.status(500).json({ error: 'Database error', details: error.message });
  }
};
