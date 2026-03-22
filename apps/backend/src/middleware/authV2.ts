/**
 * Auth v2 middleware — validates multi-role JWT access tokens.
 */
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, UserRole } from '../services/authV2';

export function requireAuthV2(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.userId   = payload.sub;
    req.userRole = payload.role;
    req.userName = payload.name;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
