import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from '../HttpError.js';
import { env } from '../../config/env.js';

function readBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return undefined;
  }
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

export const requireAccessToken: RequestHandler = (req, _res, next) => {
  try {
    const token = readBearerToken(req);
    if (!token) {
      next(new HttpError(401, 'Missing bearer token'));
      return;
    }
    if (!env.JWT_SECRET) {
      next(new HttpError(500, 'JWT secret is not configured'));
      return;
    }
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    const userId = typeof payload['sub'] === 'string' ? payload['sub'] : undefined;
    if (!userId) {
      next(new HttpError(401, 'Invalid or expired token'));
      return;
    }
    req.authUser = {
      id: userId,
      email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
      accessToken: token,
    };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
};
