// backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../types';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.auth_token || 
                  req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No authentication token provided' });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key'
    ) as AuthUser;

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
