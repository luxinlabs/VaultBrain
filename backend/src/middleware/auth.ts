import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../db/client';
import { User } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'hackathon-secret-change-me';

declare global { namespace Express { interface Request { user: User; } } }

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    const d = jwt.verify(token, JWT_SECRET) as any;
    const user = queryOne('SELECT id,email,name,role FROM dealflow_users WHERE id=?', d.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}
