import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    if (value instanceof Error) {
      return value.message;
    }
    return value;
  });
}

function sanitizeRequestBody(body: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!body) return null;
  
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'api_key', 'accessToken', 'refreshToken'];
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = '[Object]';
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

export async function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const originalPath = req.path;
  
  res.on('finish', async () => {
    try {
      const userId = req.user?.userId;
      const action = `${req.method} ${originalPath}`;
      
      if (originalPath.startsWith('/api/auth') || originalPath === '/api/health') {
        return;
      }

      const sanitizedBody = sanitizeRequestBody(req.body || null);
      const detail = safeStringify({
        method: req.method,
        path: originalPath,
        query: req.query,
        body: sanitizedBody
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action,
          targetType: req.params?.id ? 'resource' : null,
          targetId: req.params?.id || null,
          detail,
          ip: req.ip || req.connection.remoteAddress || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          result: res.statusCode < 400 ? 'success' : 'failed'
        }
      });
    } catch (error) {
      console.error('Audit log error:', error);
    }
  });

  next();
}