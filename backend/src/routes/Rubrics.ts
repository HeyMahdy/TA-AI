import { Router } from 'express';
import multer from 'multer';
import { uploadRubrics, getRubricsByAssignment, updateRubricById, createRubricManually, deleteRubricById } from '../controllers/rubricsController.js';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';

const upload = multer({ storage: multer.memoryStorage() });
export const rubricRouter = Router();

// Secure all rubric routes with global access token verification middleware
rubricRouter.use(requireAccessToken);

// 1. Process and upload multiple rubric visual sheets (Max 10 files)
rubricRouter.post(
  '/assignments/:assignmentId/rubrics/upload', 
  upload.array('files', 10), 
  uploadRubrics
);

// 2. Manually create a rubric (no file upload)
rubricRouter.post('/assignments/:assignmentId/rubrics', createRubricManually);

rubricRouter.get('/assignments/:assignmentId/rubrics', getRubricsByAssignment);

rubricRouter.patch('/assignments/:rubricId/rubrics', updateRubricById);

rubricRouter.delete('/assignments/:assignmentId/rubrics/:rubricId', deleteRubricById);