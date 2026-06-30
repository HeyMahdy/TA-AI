import type { RequestHandler } from 'express';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    message: 'Not Found',
    path: req.path,
  });
};
