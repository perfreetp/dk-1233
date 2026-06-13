import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from './auth';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      message: '未提供认证令牌' 
    });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ 
      success: false, 
      message: '无效或过期的令牌' 
    });
  }

  req.user = payload;
  next();
}

export function roleMiddleware(...requiredRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: '未认证' 
      });
    }

    const hasRole = req.user.roles.some(role => requiredRoles.includes(role));
    
    if (!hasRole) {
      return res.status(403).json({ 
        success: false, 
        message: '权限不足' 
      });
    }

    next();
  };
}