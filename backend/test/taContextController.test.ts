import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';

const queryMock = jest.fn();

jest.unstable_mockModule('../src/lib/database.js', () => ({
  pool: {
    query: queryMock,
  },
}));

const {
  getTAAssignmentOverview,
  getTAStudentAssignmentPerformance,
  resolveTAContext,
} = await import('../src/controllers/taContextController.js');

const createResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);

  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

const createRequest = (params: Record<string, string> = {}, body: Record<string, unknown> = {}) =>
  ({
    params,
    body,
    authUser: {
      id: 'teacher-uuid',
      accessToken: 'token',
    },
  }) as unknown as Request;

describe('resolveTAContext', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('resolves exact student ID and exact assignment title', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'student-uuid', student_id: 'S-1001', name: 'Mahdy Rahman', created_at: '2026-05-30' }],
      })
      .mockResolvedValueOnce({
        rows: [{ assignment_id: 12, title: 'Physics Midterm', subject: 'Physics', total_marks: 50, created_at: '2026-05-30' }],
      });

    const res = createResponse();
    await resolveTAContext(createRequest({}, { students: ['S-1001'], assignments: ['Physics Midterm'] }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0]?.[0].data.students[0]).toMatchObject({
      status: 'resolved',
      match: { student_id: 'S-1001', name: 'Mahdy Rahman', display: 'Mahdy Rahman (S-1001)' },
    });
    expect(res.json.mock.calls[0]?.[0].data.assignments[0]).toMatchObject({
      status: 'resolved',
      match: { assignment_id: 12, title: 'Physics Midterm', display: 'Physics Midterm, Physics' },
    });
  });

  it('returns friendly candidates for ambiguous student names', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'uuid-1', student_id: 'S-1001', name: 'Mahdy Rahman', created_at: null },
          { id: 'uuid-2', student_id: 'S-1002', name: 'Mahdy Islam', created_at: null },
        ],
      });

    const res = createResponse();
    await resolveTAContext(createRequest({}, { students: ['Mahdy'] }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0]?.[0].data.students[0]).toMatchObject({
      status: 'multiple_matches',
      candidates: [
        { student_id: 'S-1001', name: 'Mahdy Rahman', display: 'Mahdy Rahman (S-1001)' },
        { student_id: 'S-1002', name: 'Mahdy Islam', display: 'Mahdy Islam (S-1002)' },
      ],
    });
  });
});

describe('TA context summaries', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns assignment overview with syllabus context', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ assignment_id: 12, title: 'Physics Midterm', subject: 'Physics', total_marks: 50, created_at: '2026-05-30' }],
      })
      .mockResolvedValueOnce({
        rows: [{ question_count: 5, submitted_count: 2, graded_student_count: 1, class_average: 42, highest_score: 42, lowest_score: 42 }],
      })
      .mockResolvedValueOnce({
        rows: [{ syllabus_id: 3, status: 'completed', filename: 'physics.pdf', entity_count: 10, relationship_count: 8, created_at: '2026-05-30' }],
      });

    const res = createResponse();
    await getTAAssignmentOverview(createRequest({ assignmentId: '12' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0]?.[0].data).toMatchObject({
      assignment: { assignment_id: 12, title: 'Physics Midterm' },
      syllabus: { syllabus_id: 3, status: 'completed' },
      stats: { question_count: 5, submitted_count: 2, graded_student_count: 1 },
    });
  });

  it('returns student performance with weaknesses and syllabus context', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'student-uuid', student_id: 'S-1001', name: 'Mahdy Rahman', created_at: null }],
      })
      .mockResolvedValueOnce({
        rows: [{ assignment_id: 12, title: 'Physics Midterm', subject: 'Physics', total_marks: 50, created_at: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, question_label: 'Q1', student_solution: 'x', marks: 3, confidence_score: 0.9, ai_comment: 'Review vectors', teacher_comment: null, created_at: null, updated_at: null },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ syllabus_id: 3, status: 'completed', filename: 'physics.pdf', entity_count: 10, relationship_count: 8, created_at: null }],
      });

    const res = createResponse();
    await getTAStudentAssignmentPerformance(createRequest({ studentRef: 'S-1001', assignmentId: '12' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0]?.[0].data).toMatchObject({
      student: { student_id: 'S-1001', name: 'Mahdy Rahman' },
      assignment: { assignment_id: 12, title: 'Physics Midterm' },
      syllabus: { status: 'completed' },
      total_marks: 3,
      weaknesses: ['Review vectors'],
    });
  });
});
