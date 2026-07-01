import { Request, Response } from 'express';
import { pool } from '../lib/database.js';
import { getTAStudentWeakConcepts, resolveStudentForController } from './taContextController.js';

export const generateRemediation = async (_req: Request, res: Response) => {
  return res.status(405).json({
    error: 'TA remediation generation is not available from read-only context endpoints',
  });
};

export const getStudentFeedback = async (req: Request, res: Response) => {
  try {
    const teacherId = req.authUser?.id;
    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const student = await resolveStudentForController(teacherId, String(req.params['studentId'] ?? ''));
    if (!student) {
      return res.status(404).json({ error: 'Student not found or the reference is ambiguous' });
    }

    const result = await pool.query(
      `
        SELECT
          assignments.id as assignment_id,
          assignments.title,
          assignments.subject,
          scores.question_label,
          scores.marks,
          scores.ai_comment,
          scores.teacher_comment,
          scores.created_at
        FROM public.student_question_scores scores
        INNER JOIN public.assignments
          ON assignments.id = scores.assignment_id
          AND assignments.teacher_id = $1
        WHERE scores.teacher_id = $1
          AND scores.student_id = $2
          AND (
            (scores.ai_comment IS NOT NULL AND btrim(scores.ai_comment) <> '')
            OR (scores.teacher_comment IS NOT NULL AND btrim(scores.teacher_comment) <> '')
          )
        ORDER BY scores.created_at DESC, assignments.id DESC, scores.id ASC;
      `,
      [teacherId, student.student_uuid],
    );

    return res.status(200).json({
      message: result.rows.length === 0 ? 'No feedback found for this student' : 'Student feedback retrieved successfully',
      data: {
        student,
        count: result.rows.length,
        feedback: result.rows,
      },
    });
  } catch (error: any) {
    console.error('Error fetching student feedback:', error.message);
    return res.status(500).json({ error: 'Database error', details: error.message });
  }
};

export const getStudentWeakConcepts = async (req: Request, res: Response) => {
  req.params['studentRef'] = String(req.params['studentId'] ?? '');
  return getTAStudentWeakConcepts(req, res);
};
