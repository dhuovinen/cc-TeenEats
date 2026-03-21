import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

interface JwtPayload {
  sub: string;
  name: string;
  iat: number;
  exp: number;
}

export function requireDriverAuth(
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
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as JwtPayload;
    req.driverId = payload.sub;
    req.driverName = payload.name;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireDispatcherKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = req.headers['x-dispatcher-key'] as string;
  if (!key || key !== process.env.DISPATCHER_API_KEY) {
    res.status(401).json({ error: 'Invalid dispatcher key' });
    return;
  }
  next();
}
