import type { ErrorRequestHandler } from 'express';
import { HttpError } from '../HttpError.js';
import { logger } from '../../lib/logger.js';

function getHttpStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = Reflect.get(err, 'status');
    if (typeof status === 'number' && Number.isFinite(status)) {
      return status;
    }
  }
  return 500;
}

function getErrorMessage(err: unknown, status: number): string {
  if (status !== 500) {
    if (typeof err === 'object' && err !== null && 'message' in err) {
      const message = Reflect.get(err, 'message');
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return 'Internal Server Error';
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = getHttpStatus(err);
  if (err instanceof HttpError && status < 500) {
    logger.warn({ status, message: err.message }, 'handled client error');
  } else {
    logger.error({ err }, 'unhandled error');
  }
  const message = getErrorMessage(err, status);
  res.status(status).json({ message });
};
