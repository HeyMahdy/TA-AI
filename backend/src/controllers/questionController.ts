import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import {pool} from '../lib/database.js'

type QuestionRow = {
  id: number;
  question_label: string;
  question_description: string;
  marks: number | null;
  created_at: string;
};

type SortToken =
  | { kind: 'number'; value: number; raw: string }
  | { kind: 'roman'; value: number; raw: string }
  | { kind: 'letter'; value: number; raw: string }
  | { kind: 'text'; value: string; raw: string };

const romanNumerals: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
  xvi: 16,
  xvii: 17,
  xviii: 18,
  xix: 19,
  xx: 20,
};

const ordinalWords: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

const labelNoiseWords = new Set(['q', 'question', 'ques', 'no', 'part', 'subpart', 'section']);

function letterOrdinal(value: string) {
  let total = 0;
  for (const char of value) {
    total = total * 26 + (char.charCodeAt(0) - 96);
  }
  return total;
}

function normalizeQuestionLabel(label: unknown): SortToken[] {
  const source = String(label ?? '').toLowerCase();
  const spaced = source
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!spaced) {
    return [{ kind: 'text', value: '', raw: '' }];
  }

  return spaced
    .split(/\s+/)
    .filter((part) => !labelNoiseWords.has(part))
    .map((part): SortToken => {
      if (/^\d+$/.test(part)) {
        return { kind: 'number', value: Number(part), raw: part };
      }

      if (ordinalWords[part] !== undefined) {
        return { kind: 'number', value: ordinalWords[part], raw: part };
      }

      if (romanNumerals[part] !== undefined) {
        return { kind: 'roman', value: romanNumerals[part], raw: part };
      }

      if (/^[a-z]+$/.test(part)) {
        return { kind: 'letter', value: letterOrdinal(part), raw: part };
      }

      return { kind: 'text', value: part, raw: part };
    });
}

const tokenRank: Record<SortToken['kind'], number> = {
  number: 0,
  letter: 1,
  roman: 2,
  text: 3,
};

function compareQuestionLabels(left: string, right: string) {
  const leftTokens = normalizeQuestionLabel(left);
  const rightTokens = normalizeQuestionLabel(right);
  const maxLength = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];

    if (!leftToken) return -1;
    if (!rightToken) return 1;

    const leftRank = tokenRank[leftToken.kind];
    const rightRank = tokenRank[rightToken.kind];
    if (leftRank !== rightRank) return leftRank - rightRank;

    if ('value' in leftToken && 'value' in rightToken && leftToken.value !== rightToken.value) {
      if (typeof leftToken.value === 'number' && typeof rightToken.value === 'number') {
        return leftToken.value - rightToken.value;
      }

      return String(leftToken.value).localeCompare(String(rightToken.value), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    }

    const rawCompare = leftToken.raw.localeCompare(rightToken.raw, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (rawCompare !== 0) return rawCompare;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortQuestionsByLabel(rows: QuestionRow[]) {
  return [...rows].sort((left, right) => {
    const labelCompare = compareQuestionLabels(left.question_label, right.question_label);
    if (labelCompare !== 0) return labelCompare;
    return left.id - right.id;
  });
}

export const uploadQuestions = async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const { is_handwritten} = req.body;
    const teacherId = req.authUser?.id
    // Cast req to any to read files safely without compilation errors
    const files = (req as any).files as any[]; 
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Prepare the form data to send to FastAPI
    const formData = new FormData();
    
    // Vanilla array methods will work perfectly on the 'any[]' array
    files.forEach((file: any) => {
      formData.append('files', file.buffer, file.originalname);
    });

    formData.append('is_handwritten', String(is_handwritten));
    formData.append('teacher_id', teacherId);
    formData.append('assignment_id', assignmentId);


    const FASTAPI_URL = 'http://localhost:8000';
    
    const response = await axios.post(`${FASTAPI_URL}/internal/agent/questions/process`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    const agentResult = response.data;
    
    return res.status(200).json({
      message: 'Questions processed successfully',
      data: agentResult.analysis
    });

  } catch (error: any) {
    console.error('Error communicating with Agent service:', error.message);
    return res.status(500).json({ 
      error: 'Failed to process question document', 
      details: error.response?.data || error.message 
    });
  }
};



export const getQuestionsByAssignment = async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params;
    
    // Extracting the teacher's UUID injected by your JWT authentication middleware
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    // Query to fetch questions and verify they belong to the requesting teacher
    const query = `
      SELECT id, question_label, question_description, marks, created_at 
      FROM public.questions 
      WHERE assignment_id = $1 AND teacher_id = $2
      ORDER BY id ASC;
    `;

    const result = await pool.query(query, [assignmentId, teacherId]);

    const sortedRows = sortQuestionsByLabel(result.rows as QuestionRow[]);

    return res.status(200).json({
      message: 'Questions retrieved successfully',
      count: result.rowCount,
      data: sortedRows
    });

  } catch (error: any) {
    console.error('Error fetching questions:', error.message);
    return res.status(500).json({ 
      error: 'Database error', 
      details: error.message 
    });
  }
};





export const updateQuestionById = async (req: Request, res: Response) => {
  try {
    const { questionId } = req.params;
    const { question_label, question_description, marks } = req.body;
    
    const teacherId = req.authUser?.id;
    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    // 1. Dynamic parsing logic for optional fields
    const setFields: string[] = [];
    const queryValues: any[] = [];
    let paramIndex = 1;

    // Only update label if it's a real string with content
    if (question_label !== undefined && question_label !== null && String(question_label).trim() !== '') {
      setFields.push(`question_label = $${paramIndex++}`);
      queryValues.push(question_label);
    }

    // Only update description if it's a real string with content
    if (question_description !== undefined && question_description !== null && String(question_description).trim() !== '') {
      setFields.push(`question_description = $${paramIndex++}`);
      queryValues.push(question_description);
    }

    // Only update marks if it's a valid numerical representation
    if (marks !== undefined && marks !== null && marks !== '') {
      setFields.push(`marks = $${paramIndex++}`);
      queryValues.push(Number(marks));
    }

    // 🚨 If the user didn't pass any actionable changes, don't update anything!
    // Just return the existing row context so the frontend doesn't break.
    if (setFields.length === 0) {
      const existingQuery = `
        SELECT id, question_label, question_description, marks, created_at 
        FROM public.questions 
        WHERE id = $1 AND teacher_id = $2;
      `;
      const fallbackResult = await pool.query(existingQuery, [questionId, teacherId]);
      
      if (!fallbackResult.rows || fallbackResult.rows.length === 0) {
        return res.status(404).json({ error: 'Question not found' });
      }

      return res.status(200).json({
        message: 'No modifications requested. Question remained unchanged.',
        data: fallbackResult.rows[0]
      });
    }

    // 2. Append parameters for row identity verification
    queryValues.push(questionId);
    const questionIdParam = `$${paramIndex++}`;

    queryValues.push(teacherId);
    const teacherIdParam = `$${paramIndex++}`;

    // 3. Assemble and execute the query safely
    const query = `
      UPDATE public.questions 
      SET ${setFields.join(', ')}
      WHERE id = ${questionIdParam} AND teacher_id = ${teacherIdParam}
      RETURNING id, question_label, question_description, marks, created_at;
    `;

    const result = await pool.query(query, queryValues);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Question not found or you are not authorized to modify it' 
      });
    }

    return res.status(200).json({
      message: 'Question updated successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error updating question by ID:', error.message);
    return res.status(500).json({ 
      error: 'Database error', 
      details: error.message 
    });
  }
};

export const deleteQuestionById = async (req: Request, res: Response) => {
  try {
    const { questionId } = req.params;
    const teacherId = req.authUser?.id;

    if (!teacherId) {
      return res.status(401).json({ error: 'Unauthorized: Missing teacher identity' });
    }

    const query = `
      DELETE FROM public.questions
      WHERE id = $1 AND teacher_id = $2
      RETURNING id, question_label;
    `;

    const result = await pool.query(query, [questionId, teacherId]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Question not found or you are not authorized to delete it'
      });
    }

    return res.status(200).json({
      message: 'Question deleted successfully',
      data: result.rows[0]
    });

  } catch (error: any) {
    console.error('Error deleting question by ID:', error.message);
    return res.status(500).json({
      error: 'Database error',
      details: error.message
    });
  }
};
