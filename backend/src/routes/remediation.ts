import { Router } from 'express';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';
import { generateRemediation, getStudentFeedback, getStudentWeakConcepts } from '../controllers/remediationController.js';

export const remediationRouter = Router();

remediationRouter.use(requireAccessToken);

remediationRouter.post('/remediation/generate', generateRemediation);
remediationRouter.get('/students/:studentId/feedback', getStudentFeedback);
remediationRouter.get('/students/:studentId/weak-concepts', getStudentWeakConcepts);
