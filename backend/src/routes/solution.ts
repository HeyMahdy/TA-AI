import { Router } from 'express';
import multer from 'multer';
import { uploadSolutions, getSolutionsByAssignment, updateSolutionById, deleteSolutionById } from '../controllers/solutionController.js';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';

const upload = multer({ storage: multer.memoryStorage() });
export const solutionRouter = Router();

// Secure all solution routes with global access token verification middleware
solutionRouter.use(requireAccessToken);

// 1. Process and upload multiple solution files (Max 10 files)
solutionRouter.post(
  '/assignments/:assignmentId/solutions/upload', 
  upload.array('files', 10), 
  uploadSolutions
);

solutionRouter.get('/assignments/:assignmentId/solutions', getSolutionsByAssignment);

solutionRouter.patch('/assignments/:solutionId/solutions', updateSolutionById);

solutionRouter.delete('/assignments/:assignmentId/solutions/:solutionId', deleteSolutionById);