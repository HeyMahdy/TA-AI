import { Request, Response } from 'express';
import {
  getTAAssignmentMistakes,
  getTAAssignmentOverview,
  getTAStudentOverview,
} from './taContextController.js';

export const getAssignmentAnalytics = async (req: Request, res: Response) => {
  return getTAAssignmentOverview(req, res);
};

export const getAssignmentMistakes = async (req: Request, res: Response) => {
  return getTAAssignmentMistakes(req, res);
};

export const getStudentProgress = async (req: Request, res: Response) => {
  req.params['studentRef'] = String(req.params['studentId'] ?? '');
  return getTAStudentOverview(req, res);
};
