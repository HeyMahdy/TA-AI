import { Router } from 'express';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';
import { getAssignmentAnalytics, getAssignmentMistakes, getStudentProgress } from '../controllers/analyticsController.js';

export const analyticsRouter = Router();

analyticsRouter.use(requireAccessToken);

analyticsRouter.get('/analytics/assignments/:assignmentId', getAssignmentAnalytics);
analyticsRouter.get('/analytics/assignments/:assignmentId/mistakes', getAssignmentMistakes);
analyticsRouter.get('/analytics/students/:studentId/progress', getStudentProgress);
