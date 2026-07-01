import { Router } from 'express';
import { authRouter } from './authRoute.js';
import { healthRouter } from './healthRoute.js';
import { userRouter } from './userRoute.js';
import { assignmentRouter } from './Assignment.js';
import { questionRouter } from './Question.js';
import { rubricRouter } from './Rubrics.js';
import { solutionRouter } from './solution.js';
import { studentRouter } from './student.js';
import { studentAnswerRouter } from './studentAnswer.js';
import { gradingRouter } from './grading.js';
import { syllabusRouter } from './syllabus.js';
import { taChatRouter } from './taChat.js';
import { taContextRouter } from './taContext.js';
import { analyticsRouter } from './analytics.js';
import { remediationRouter } from './remediation.js';


export const rootRouter = Router();

rootRouter.use(healthRouter);
rootRouter.use('/auth', authRouter);
rootRouter.use('/users', userRouter);
rootRouter.use('/assignments', assignmentRouter);
rootRouter.use('/teachers', assignmentRouter);
rootRouter.use('/', questionRouter);
rootRouter.use('/', rubricRouter);
rootRouter.use('/', solutionRouter);
rootRouter.use('/', studentRouter);
rootRouter.use('/', studentAnswerRouter);
rootRouter.use('/', gradingRouter);
rootRouter.use('/', syllabusRouter);
rootRouter.use('/', taChatRouter);
rootRouter.use('/', taContextRouter);
rootRouter.use('/', analyticsRouter);
rootRouter.use('/', remediationRouter);
