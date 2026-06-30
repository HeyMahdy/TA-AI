import type { RequestHandler } from 'express';
import { logger } from '../../lib/logger.js';

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      },
      'request completed',
    );
  });
  next();
};
