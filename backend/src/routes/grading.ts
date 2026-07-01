import { Router } from 'express';
import {
  startGrading,
  getAssignmentSubmittedStudentsScores,
  getGradingResults,
  updateGradingResult
} from '../controllers/gradingController.js';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';

export const gradingRouter = Router();

gradingRouter.use(requireAccessToken);

// Trigger grading for a student's assignment
gradingRouter.post('/assignments/:assignmentId/students/:studentId/grade', startGrading);

// Get submitted students for an assignment with total marks
gradingRouter.get('/assignments/:assignmentId/students/scores', getAssignmentSubmittedStudentsScores);

// Get grading results for a student on an assignment
gradingRouter.get('/assignments/:assignmentId/students/:studentId/scores', getGradingResults);

// Update a grading result after teacher review
gradingRouter.patch('/assignments/:assignmentId/students/:studentId/scores/:scoreId', updateGradingResult);
