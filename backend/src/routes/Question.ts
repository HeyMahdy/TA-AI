

import { Router } from 'express';
import multer from 'multer';
import { uploadQuestions,getQuestionsByAssignment,updateQuestionById,deleteQuestionById } from '../controllers/questionController.js';
import { requireAccessToken } from '../common/middleware/jwt.middleware.js';



const upload = multer({ storage: multer.memoryStorage() });
export const questionRouter = Router();
questionRouter.use(requireAccessToken);

// Accept up to 10 files under the field name 'files'
questionRouter.post(
  '/assignments/:assignmentId/questions/upload', 
  upload.array('files', 10), 
  uploadQuestions
);

questionRouter.get('/assignments/:assignmentId/questions',getQuestionsByAssignment)
questionRouter.patch('/assignments/:questionId/questions',updateQuestionById)
questionRouter.delete('/assignments/:questionId/questions',deleteQuestionById)
