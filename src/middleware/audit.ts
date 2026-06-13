import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

export async function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  res.on('finish', async () => {
    try {
      const userId = req.user?.userId;
      const action = `${req.method} ${req.path}`;
      
      if (req.path.startsWith('/api/auth') || req.path === '/api/health') {
        return;
      }

      await prisma.auditLog.create({
        data: {
          userId,
          action,
          targetType: req.params?.id ? 'resource' : null,
          targetId: req.params?.id || null,
          detail: JSON.stringify({
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body ? Object.keys(req.body).reduce((acc, key) => {
              if (key !== 'password') {
                acc[key] = req.body[key];
              }
              return acc;
            }, {} as Record<string, unknown>) : null
          }),
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          result: res.statusCode < 400 ? 'success' : 'failed'
        }
      });
    } catch (error) {
      console.error('Audit log error:', error);
    }
  });

  next();
}