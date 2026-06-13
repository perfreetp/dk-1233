import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/alerts', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 20, type, level, isRead, isHandled } = req.query;
    
    const where: Record<string, unknown> = {};
    
    if (type) {
      where.type = type;
    }
    
    if (level) {
      where.level = level;
    }
    
    if (isRead !== undefined) {
      where.isRead = isRead === 'true';
    }
    
    if (isHandled !== undefined) {
      where.isHandled = isHandled === 'true';
    }

    const [total, alerts] = await Promise.all([
      prisma.alert.count({ where }),
      prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize)
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        list: alerts
      }
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      message: '获取告警列表失败'
    });
  }
});

router.get('/alerts/unread-count', authMiddleware, async (req: Request, res: Response) => {
  try {
    const count = await prisma.alert.count({
      where: { isRead: false }
    });

    const highRiskCount = await prisma.alert.count({
      where: { isRead: false, level: 'high' }
    });

    res.json({
      success: true,
      data: {
        total: count,
        highRisk: highRiskCount
      }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: '获取未读告警数量失败'
    });
  }
});

router.post('/alerts/:id/read', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.alert.update({
      where: { id },
      data: { isRead: true }
    });

    res.json({
      success: true,
      message: '告警已标记为已读'
    });
  } catch (error) {
    console.error('Mark alert read error:', error);
    res.status(500).json({
      success: false,
      message: '标记告警已读失败'
    });
  }
});

router.post('/alerts/:id/handle', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { handleResult } = req.body;

    await prisma.alert.update({
      where: { id },
      data: {
        isHandled: true,
        handlerId: req.user!.userId,
        handleResult,
        handledAt: new Date()
      }
    });

    res.json({
      success: true,
      message: '告警已处理'
    });
  } catch (error) {
    console.error('Handle alert error:', error);
    res.status(500).json({
      success: false,
      message: '处理告警失败'
    });
  }
});

router.post('/alerts/batch-read', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
      return res.status(400).json({
        success: false,
        message: 'ids 必须是数组'
      });
    }

    await prisma.alert.updateMany({
      where: { id: { in: ids } },
      data: { isRead: true }
    });

    res.json({
      success: true,
      message: '批量标记已读成功'
    });
  } catch (error) {
    console.error('Batch read alerts error:', error);
    res.status(500).json({
      success: false,
      message: '批量标记已读失败'
    });
  }
});

router.get('/alerts/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { startTime, endTime } = req.query;
    
    const where: Record<string, unknown> = {};
    
    if (startTime || endTime) {
      where.createdAt = {};
      if (startTime) {
        (where.createdAt as Record<string, unknown>).gte = new Date(startTime as string);
      }
      if (endTime) {
        (where.createdAt as Record<string, unknown>).lte = new Date(endTime as string);
      }
    }

    const stats = await prisma.alert.groupBy({
      by: ['type', 'level'],
      where,
      _count: { id: true }
    });

    const typeStats = await prisma.alert.groupBy({
      by: ['type'],
      where,
      _count: { id: true }
    });

    const levelStats = await prisma.alert.groupBy({
      by: ['level'],
      where,
      _count: { id: true }
    });

    res.json({
      success: true,
      data: {
        detailed: stats,
        byType: typeStats.map(s => ({ type: s.type, count: s._count.id })),
        byLevel: levelStats.map(s => ({ level: s.level, count: s._count.id }))
      }
    });
  } catch (error) {
    console.error('Get alert stats error:', error);
    res.status(500).json({
      success: false,
      message: '获取告警统计失败'
    });
  }
});

export default router;