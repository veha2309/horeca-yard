import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { RequestHandler, Request } from 'express';
import { Database, AppError } from './db.js';
export const hashToken = (s: string) => createHash('sha256').update(s).digest('hex');
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password: string, hash: string) {
  const [salt, key] = hash.split(':');
  const actual = scryptSync(password, salt, 64);
  return (
    actual.length === Buffer.from(key, 'hex').length &&
    timingSafeEqual(actual, Buffer.from(key, 'hex'))
  );
}
export const cookie = (value: string, production: boolean, age = 28800) =>
  `hy_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${production ? '; Secure' : ''}`;
export function sessionToken(req: Request) {
  return req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('hy_session='))
    ?.slice(11);
}
export function auth(db: Database): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = sessionToken(req);
      if (!token) throw new AppError(401, 'Please sign in');
      const user = (
        await db.query(
          'SELECT u.id,u.email,u.name,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>now() AND u.active=true',
          [hashToken(token)],
        )
      ).rows[0];
      if (!user) throw new AppError(401, 'Your session expired. Please sign in again.');
      res.locals.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function roles(...allowed: string[]): RequestHandler {
  return (_req, res, next) =>
    allowed.includes(res.locals.user.role)
      ? next()
      : next(new AppError(403, 'Your role cannot perform this action'));
}
