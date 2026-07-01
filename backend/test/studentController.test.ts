import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';

const queryMock = jest.fn();

jest.unstable_mockModule('../src/lib/database.js', () => ({
  pool: {
    query: queryMock,
  },
}));

const { getStudentAssignmentGrades, getStudentAssignmentsWithMarks } = await import('../src/controllers/studentController.js');

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

const createRequest = (authUserId?: string, studentId = 'student-uuid') => ({
  params: { studentId },
  authUser: authUserId
    ? {
        id: authUserId,
        accessToken: 'token',
      }
    : undefined,
}) as unknown as Request;

describe('getStudentAssignmentsWithMarks', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns all teacher assignments with summed student marks', async () => {
    const student = {
      teacher_id: 'teacher-uuid',
      id: 'student-uuid',
      student_id: 'S-1001',
      name: 'Student Name',
      created_at: '2026-05-30T10:00:00.000Z',
    };
    const assignments = [
      {
        assignment_id: 12,
        title: 'Physics Assignment',
        subject: 'Physics',
        assignment_total_marks: 50,
        marks_obtained: 42.5,
        graded_question_count: 5,
        created_at: '2026-05-30T10:00:00.000Z',
      },
    ];

    queryMock
      .mockResolvedValueOnce({ rows: [student] })
      .mockResolvedValueOnce({ rows: assignments });

    const res = createResponse();

    await getStudentAssignmentsWithMarks(createRequest('teacher-uuid'), res);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenNthCalledWith(1, expect.any(String), ['teacher-uuid', 'student-uuid']);
    expect(queryMock).toHaveBeenNthCalledWith(2, expect.any(String), ['teacher-uuid', 'student-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Student assignment marks retrieved successfully',
      student,
      data: assignments,
    });
    expect(res.json.mock.calls[0]?.[0]).not.toHaveProperty('count');
  });

  it('returns ungraded assignments with zero marks', async () => {
    const student = {
      teacher_id: 'teacher-uuid',
      id: 'student-uuid',
      student_id: 'S-1001',
      name: 'Student Name',
      created_at: '2026-05-30T10:00:00.000Z',
    };
    const assignments = [
      {
        assignment_id: 13,
        title: 'Chemistry Assignment',
        subject: 'Chemistry',
        assignment_total_marks: 25,
        marks_obtained: 0,
        graded_question_count: 0,
        created_at: '2026-05-30T11:00:00.000Z',
      },
    ];

    queryMock
      .mockResolvedValueOnce({ rows: [student] })
      .mockResolvedValueOnce({ rows: assignments });

    const res = createResponse();

    await getStudentAssignmentsWithMarks(createRequest('teacher-uuid'), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Student assignment marks retrieved successfully',
      student,
      data: assignments,
    });
  });

  it('returns 404 when the student does not belong to the teacher', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = createResponse();

    await getStudentAssignmentsWithMarks(createRequest('teacher-uuid'), res);

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Student not found or you are not authorized to view it',
    });
  });

  it('returns 401 when the authenticated teacher identity is missing', async () => {
    const res = createResponse();

    await getStudentAssignmentsWithMarks(createRequest(), res);

    expect(queryMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Missing teacher identity' });
  });
});

describe('getStudentAssignmentGrades', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns only graded assignments with summed student marks', async () => {
    const student = {
      teacher_id: 'teacher-uuid',
      id: 'student-uuid',
      student_id: 'S-1001',
      name: 'Student Name',
      created_at: '2026-05-30T10:00:00.000Z',
    };
    const grades = [
      {
        assignment_id: 12,
        title: 'Physics Assignment',
        subject: 'Physics',
        assignment_total_marks: 50,
        marks_obtained: 42.5,
        graded_question_count: 5,
        created_at: '2026-05-30T10:00:00.000Z',
      },
    ];

    queryMock
      .mockResolvedValueOnce({ rows: [student] })
      .mockResolvedValueOnce({ rowCount: grades.length, rows: grades });

    const res = createResponse();

    await getStudentAssignmentGrades(createRequest('teacher-uuid', 'S-1001'), res);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenNthCalledWith(1, expect.any(String), ['teacher-uuid', 'S-1001']);
    expect(queryMock).toHaveBeenNthCalledWith(2, expect.any(String), ['teacher-uuid', 'student-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Student assignment grades retrieved successfully',
      student,
      count: grades.length,
      data: grades,
    });
  });

  it('excludes ungraded assignments', async () => {
    const student = {
      teacher_id: 'teacher-uuid',
      id: 'student-uuid',
      student_id: 'S-1001',
      name: 'Student Name',
      created_at: '2026-05-30T10:00:00.000Z',
    };

    queryMock
      .mockResolvedValueOnce({ rows: [student] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = createResponse();

    await getStudentAssignmentGrades(createRequest('teacher-uuid', 'S-1001'), res);

    expect(queryMock).toHaveBeenNthCalledWith(1, expect.any(String), ['teacher-uuid', 'S-1001']);
    expect(queryMock).toHaveBeenNthCalledWith(2, expect.any(String), ['teacher-uuid', 'student-uuid']);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Student assignment grades retrieved successfully',
      student,
      count: 0,
      data: [],
    });
  });

  it('returns 404 when the student does not belong to the teacher', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = createResponse();

    await getStudentAssignmentGrades(createRequest('teacher-uuid', 'S-9999'), res);

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenNthCalledWith(1, expect.any(String), ['teacher-uuid', 'S-9999']);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Student not found or you are not authorized to view it',
    });
  });

  it('returns 401 when the authenticated teacher identity is missing', async () => {
    const res = createResponse();

    await getStudentAssignmentGrades(createRequest(), res);

    expect(queryMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Missing teacher identity' });
  });
});
