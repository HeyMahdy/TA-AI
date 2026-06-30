import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { pool } from '../lib/database.js';

/**
 * Upload and process multiple grading rubric files via FastAPI Agent layer
 */
export const uploadRubrics = async (req: Request, res: Response) => {
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
      return res.status(400).json({ error: 'No rubric files uploaded' });
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
    
    // Dispatch to the specific rubrics agent processing path
    const response = await axios.post(`${FASTAPI_URL}/internal/agent/rubrics/process`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    const agentResult = response.data;
    
    return res.status(200).json({
      message: 'Rubrics processed successfully',
      data: agentResult.analysis
    });

  } catch (error: any) {
    console.error('Error communicating with Rubrics Agent service:', error.message);
    return res.status(500).json({ 
      error: 'Failed to process rubric document', 
      details: error.response?.data || error.message 
    });
  }
};

/**
 * Get all rubrics belonging to a specific assignment
 */
export const getRubricsByAssignment = async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    // Query to fetch rubrics and verify ownership
    const query = `
      SELECT id, question_label, rubric_description, created_at 
      FROM public.rubrics 
      WHERE assignment_id = $1 AND teacher_id = $2
      ORDER BY id ASC;
    `;

    const result = await pool.query(query, [assignmentId, teacherId]);

    return res.status(200).json({
      message: 'Rubrics retrieved successfully',
      count: result.rowCount ?? (result.rows ? result.rows.length : 0),
      data: result.rows
    });

  } catch (error: any) {
    console.error('Error fetching rubrics:', error.message);
    return res.status(500).json({ 
      error: 'Database error', 
      details: error.message 
    });
  }
};

/**
 * Update an existing rubric item dynamically by its distinct ID (Partial fields optional)
 */
export const updateRubricById = async (req: Request, res: Response) => {
  try {
    const { rubricId } = req.params;
    const { question_label, rubric_description } = req.body;
    
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

    // Validate and update structural JSONB objects (handles object payloads securely)
    if (rubric_description !== undefined && rubric_description !== null && typeof rubric_description === 'object') {
      setFields.push(`rubric_description = $${paramIndex++}`);
      queryValues.push(JSON.stringify(rubric_description)); // Stringify to bind flawlessly into modern pg jsonb parameters
    }

    // 🚨 Safety Check: If no modifications are requested, protect history and early-return
    if (setFields.length === 0) {
      const existingQuery = `
        SELECT id, question_label, rubric_description, created_at 
        FROM public.rubrics 
        WHERE id = $1 AND teacher_id = $2;
      `;
      const fallbackResult = await pool.query(existingQuery, [rubricId, teacherId]);
      
      if (!fallbackResult.rows || fallbackResult.rows.length === 0) {
        return res.status(404).json({ error: 'Rubric not found' });
      }

      return res.status(200).json({
        message: 'No modifications requested. Rubric remained unchanged.',
        data: fallbackResult.rows[0]
      });
    }

    // 2. Inject context constraint targets
    queryValues.push(rubricId);
    const rubricIdParam = `$${paramIndex++}`;

    queryValues.push(teacherId);
    const teacherIdParam = `$${paramIndex++}`;

    // 3. Assemble structural update statements
    const query = `
      UPDATE public.rubrics 
      SET ${setFields.join(', ')}
      WHERE id = ${rubricIdParam} AND teacher_id = ${teacherIdParam}
      RETURNING id, question_label, rubric_description, created_at;
    `;

    const result = await pool.query(query, queryValues);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Rubric not found or you are not authorized to modify it' 
      });
    }

    return res.status(200).json({
      message: 'Rubric updated successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error updating rubric by ID:', error.message);
    return res.status(500).json({ 
      error: 'Database error', 
      details: error.message 
    });
  }
};


/**
 * Manually create a rubric for a question (no file upload / no AI)
 */
export const createRubricManually = async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const { question_label, rubric_description } = req.body;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    if (!question_label || !rubric_description) {
      return res.status(400).json({ error: 'question_label and rubric_description are required' });
    }

    if (typeof rubric_description !== 'object') {
      return res.status(400).json({ error: 'rubric_description must be a JSON object' });
    }

    const query = `
      INSERT INTO public.rubrics (teacher_id, assignment_id, question_label, rubric_description)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, question_label, rubric_description, created_at;
    `;

    const result = await pool.query(query, [
      teacherId,
      assignmentId,
      question_label,
      JSON.stringify(rubric_description)
    ]);

    return res.status(201).json({
      message: 'Rubric created successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error creating rubric manually:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};


/**
 * Delete a rubric by ID and assignment ID
 */
export const deleteRubricById = async (req: Request, res: Response) => {
  try {
    const { assignmentId, rubricId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const query = `
      DELETE FROM public.rubrics
      WHERE id = $1 AND assignment_id = $2 AND teacher_id = $3
      RETURNING id, question_label;
    `;

    const result = await pool.query(query, [rubricId, assignmentId, teacherId]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Rubric not found or you are not authorized to delete it'
      });
    }

    return res.status(200).json({
      message: 'Rubric deleted successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error deleting rubric:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};
