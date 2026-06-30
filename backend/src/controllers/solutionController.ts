import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { pool } from '../lib/database.js';

/**
 * Upload and process multiple solution files via FastAPI Agent layer
 */
export const uploadSolutions = async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const { is_handwritten } = req.body;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    // Cast req to any to read files safely without compilation errors
    const files = (req as any).files as any[]; 
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No solution files uploaded' });
    }

    // Prepare the form data to send to FastAPI
    const formData = new FormData();
    
    files.forEach((file: any) => {
      formData.append('files', file.buffer, file.originalname);
    });

    formData.append('is_handwritten', String(is_handwritten));
    formData.append('teacher_id', teacherId);
    formData.append('assignment_id', assignmentId);

    const FASTAPI_URL = 'http://localhost:8000';
    
    // Dispatch to the specific solutions agent processing path
    const response = await axios.post(`${FASTAPI_URL}/internal/agent/solutions/process`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    const agentResult = response.data;
    
    return res.status(200).json({
      message: 'Solutions processed successfully',
      data: agentResult.analysis
    });

  } catch (error: any) {
    console.error('Error communicating with Solutions Agent service:', error.message);
    return res.status(500).json({ 
      error: 'Failed to process solution document', 
      details: error.response?.data || error.message 
    });
  }
};

/**
 * Get all solutions belonging to a specific assignment
 */
export const getSolutionsByAssignment = async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    // Query to fetch solutions and verify ownership
    const query = `
      SELECT id, question_label, solution_text, created_at 
      FROM public.teacher_solutions 
      WHERE assignment_id = $1 AND teacher_id = $2
      ORDER BY id ASC;
    `;

    const result = await pool.query(query, [assignmentId, teacherId]);

    return res.status(200).json({
      message: 'Solutions retrieved successfully',
      count: result.rowCount ?? (result.rows ? result.rows.length : 0),
      data: result.rows
    });

  } catch (error: any) {
    console.error('Error fetching solutions:', error.message);
    return res.status(500).json({ 
      error: 'Database error', 
      details: error.message 
    });
  }
};

/**
 * Update an existing solution item dynamically by its distinct ID (Partial fields optional)
 */
export const updateSolutionById = async (req: Request, res: Response) => {
  try {
    const { solutionId } = req.params;
    const { question_label, solution_text } = req.body;
    
    const teacherId = req.authUser?.id;
    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    // 1. Dynamic query construction for optional properties
    const setFields: string[] = [];
    const queryValues: any[] = [];
    let paramIndex = 1;

    // Validate and update text fields
    if (question_label !== undefined && question_label !== null && String(question_label).trim() !== '') {
      setFields.push(`question_label = $${paramIndex++}`);
      queryValues.push(question_label);
    }

    if (solution_text !== undefined && solution_text !== null && String(solution_text).trim() !== '') {
      setFields.push(`solution_text = $${paramIndex++}`);
      queryValues.push(solution_text);
    }

    // 🚨 Safety Check: If no modifications are requested, protect history and early-return
    if (setFields.length === 0) {
      const existingQuery = `
        SELECT id, question_label, solution_text, created_at 
        FROM public.teacher_solutions 
        WHERE id = $1 AND teacher_id = $2;
      `;
      const fallbackResult = await pool.query(existingQuery, [solutionId, teacherId]);
      
      if (!fallbackResult.rows || fallbackResult.rows.length === 0) {
        return res.status(404).json({ error: 'Solution not found' });
      }

      return res.status(200).json({
        message: 'No modifications requested. Solution remained unchanged.',
        data: fallbackResult.rows[0]
      });
    }

    // 2. Inject context constraint targets
    queryValues.push(solutionId);
    const solutionIdParam = `$${paramIndex++}`;

    queryValues.push(teacherId);
    const teacherIdParam = `$${paramIndex++}`;

    // 3. Assemble structural update statements
    const query = `
      UPDATE public.teacher_solutions 
      SET ${setFields.join(', ')}
      WHERE id = ${solutionIdParam} AND teacher_id = ${teacherIdParam}
      RETURNING id, question_label, solution_text, created_at;
    `;

    const result = await pool.query(query, queryValues);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Solution not found or you are not authorized to modify it' 
      });
    }

    return res.status(200).json({
      message: 'Solution updated successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error updating solution by ID:', error.message);
    return res.status(500).json({ 
      error: 'Database error', 
      details: error.message 
    });
  }
};


/**
 * Delete a teacher solution by ID and assignment ID
 */
export const deleteSolutionById = async (req: Request, res: Response) => {
  try {
    const { assignmentId, solutionId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const query = `
      DELETE FROM public.teacher_solutions
      WHERE id = $1 AND assignment_id = $2 AND teacher_id = $3
      RETURNING id, question_label;
    `;

    const result = await pool.query(query, [solutionId, assignmentId, teacherId]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Solution not found or you are not authorized to delete it'
      });
    }

    return res.status(200).json({
      message: 'Solution deleted successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error deleting solution:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};
