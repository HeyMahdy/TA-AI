import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';

const queryMock = jest.fn();

jest.unstable_mockModule('../src/lib/database.js', () => ({
  pool: {
    query: queryMock,
  },
}));

const { getAssignmentSubmittedStudentsScores } = await import('../src/controllers/gradingController.js');

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

const createRequest = (authUserId?: string) => ({
  params: { assignmentId: '12' },
  authUser: authUserId
    ? {
        id: authUserId,
        accessToken: 'token',
      }
    : undefined,
}) as unknown as Request;

describe('getAssignmentSubmittedStudentsScores', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns submitted students with summed marks', async () => {
    const assignment = {
      assignment_id: 12,
      title: 'Physics Assignment',
      subject: 'Physics',
      assignment_total_marks: 50,
    };
    const submittedStudents = [
      {
        id: 'student-uuid',
        student_id: 'S-1001',
        name: 'Student Name',
        marks_obtained: 42.5,
        assignment_total_marks: 50,
        submitted_question_count: 5,
        graded_question_count: 5,
        latest_submission_at: '2026-05-30T10:00:00.000Z',
      },
    ];

    queryMock
      .mockResolvedValueOnce({ rows: [assignment] })
      .mockResolvedValueOnce({ rowCount: submittedStudents.length, rows: submittedStudents });

    const res = createResponse();

    await getAssignmentSubmittedStudentsScores(createRequest('teacher-uuid'), res);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenNthCalledWith(1, expect.any(String), ['12', 'teacher-uuid']);
    expect(queryMock).toHaveBeenNthCalledWith(2, expect.any(String), ['12', 'teacher-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Assignment submitted students scores retrieved successfully',
      assignment,
      count: submittedStudents.length,
      data: submittedStudents,
    });
  });

  it('returns submitted but ungraded students with zero marks', async () => {
    const assignment = {
      assignment_id: 12,
      title: 'Physics Assignment',
      subject: 'Physics',
      assignment_total_marks: 50,
    };
    const submittedStudents = [
      {
        id: 'student-uuid',
        student_id: 'S-1001',
        name: 'Student Name',
        marks_obtained: 0,
        assignment_total_marks: 50,
        submitted_question_count: 5,
        graded_question_count: 0,
        latest_submission_at: '2026-05-30T10:00:00.000Z',
      },
    ];

    queryMock
      .mockResolvedValueOnce({ rows: [assignment] })
      .mockResolvedValueOnce({ rowCount: submittedStudents.length, rows: submittedStudents });

    const res = createResponse();

    await getAssignmentSubmittedStudentsScores(createRequest('teacher-uuid'), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Assignment submitted students scores retrieved successfully',
      assignment,
      count: submittedStudents.length,
      data: submittedStudents,
    });
  });

  it('returns 404 when the assignment does not belong to the teacher', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = createResponse();

    await getAssignmentSubmittedStudentsScores(createRequest('teacher-uuid'), res);

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Assignment not found or you are not authorized to view it',
    });
  });

  it('returns 401 when the authenticated teacher identity is missing', async () => {
    const res = createResponse();

    await getAssignmentSubmittedStudentsScores(createRequest(), res);

    expect(queryMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Missing teacher identity' });
  });
});
