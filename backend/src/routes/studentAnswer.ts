import { Router } from 'express';
import multer from 'multer';
import { uploadStudentAnswers, getStudentAnswersByAssignment, updateStudentAnswerById } from '../controllers/studentAnswerController.js';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';

const upload = multer({ storage: multer.memoryStorage() });
export const studentAnswerRouter = Router();

studentAnswerRouter.use(requireAccessToken);

// Upload student answer files (Max 10 files)
studentAnswerRouter.post(
  '/assignments/:assignmentId/students/:studentId/answers/upload',
  upload.array('files', 10),
  uploadStudentAnswers
);

// Get all answers for a student on an assignment
studentAnswerRouter.get('/assignments/:assignmentId/students/:studentId/answers', getStudentAnswersByAssignment);

// Update a student answer by ID
studentAnswerRouter.patch('/student-answers/:answerId', updateStudentAnswerById);
