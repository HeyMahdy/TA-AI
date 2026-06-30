import { Router } from 'express';
import { uploadAnswer, getStudentAnswers, getExtractedAnswer } from '../controllers/answerController.js';

export const answerRouter = Router();
answerRouter.post('/answers/upload', uploadAnswer);
answerRouter.get('/assignments/:assignmentId/students/:studentId/answers', getStudentAnswers);
answerRouter.get('/answers/:answerId/extracted', getExtractedAnswer);
