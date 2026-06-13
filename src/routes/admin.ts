import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { batchPermissionSchema } from '../validators';

const router = Router();

router.post('/departments/batch-permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = batchPermissionSchema.parse(req.body);
    
    const department = await prisma.department.findUnique({
      where: { id: data.departmentId }
    });

    if (!department) {
      return res.status(404).json({
        success: false,
        message: '部门不存在'
      });
    }

    await prisma.$transaction(
      data.permissionIds.map(permissionId =>
        prisma.departmentPermission.upsert({
          where: {
            departmentId_permissionId: {
              departmentId: data.departmentId,
              permissionId
            }
          },
          create: {
            departmentId: data.departmentId,
            permissionId,
            inherit: data.inherit,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null
          },
          update: {
            inherit: data.inherit,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null
          }
        })
      )
    );

    res.json({
      success: true,
      message: '批量权限分配成功'
    });
  } catch (error) {
    console.error('Batch permission error:', error);
    res.status(400).json({
      success: false,
      message: '批量权限分配失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.get('/departments/:id/inheritance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const department = await prisma.department.findUnique({
      where: { id },
      include: {
        parent: true,
        permissions: {
          include: { permission: true }
        }
      }
    });

    if (!department) {
      return res.status(404).json({
        success: false,
        message: '部门不存在'
      });
    }

    const inheritanceChain: {
      department: { id: string; name: string; code: string };
      permissions: { id: string; name: string; code: string; inherit: boolean; expiresAt: Date | null }[];
    }[] = [];

    inheritanceChain.push({
      department: { id: department.id, name: department.name, code: department.code },
      permissions: department.permissions.map(dp => ({
        id: dp.permission.id,
        name: dp.permission.name,
        code: dp.permission.code,
        inherit: dp.inherit,
        expiresAt: dp.expiresAt
      }))
    });

    if (department.parentId) {
      const parentChain = await getDepartmentInheritanceChain(department.parentId);
      inheritanceChain.push(...parentChain);
    }

    res.json({
      success: true,
      data: {
        currentDepartment: {
          id: department.id,
          name: department.name,
          code: department.code
        },
        inheritanceChain
      }
    });
  } catch (error) {
    console.error('Get inheritance error:', error);
    res.status(500).json({
      success: false,
      message: '获取权限继承关系失败'
    });
  }
});

async function getDepartmentInheritanceChain(departmentId: string): Promise<{
  department: { id: string; name: string; code: string };
  permissions: { id: string; name: string; code: string; inherit: boolean; expiresAt: Date | null }[];
}[]> {
  const chain: {
    department: { id: string; name: string; code: string };
    permissions: { id: string; name: string; code: string; inherit: boolean; expiresAt: Date | null }[];
  }[] = [];

  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    include: {
      parent: true,
      permissions: {
        where: { inherit: true },
        include: { permission: true }
      }
    }
  });

  if (dept) {
    chain.push({
      department: { id: dept.id, name: dept.name, code: dept.code },
      permissions: dept.permissions.map(dp => ({
        id: dp.permission.id,
        name: dp.permission.name,
        code: dp.permission.code,
        inherit: dp.inherit,
        expiresAt: dp.expiresAt
      }))
    });

    if (dept.parentId) {
      const parentChain = await getDepartmentInheritanceChain(dept.parentId);
      chain.push(...parentChain);
    }
  }

  return chain;
}

router.get('/audit-logs', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 50, userId, action, targetType, targetId, startTime, endTime, result } = req.query;
    
    const where: Record<string, unknown> = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (action) {
      where.action = { contains: action as string };
    }
    
    if (targetType && targetId) {
      where.targetType = targetType;
      where.targetId = targetId;
    }
    
    if (startTime || endTime) {
      where.createdAt = {};
      if (startTime) {
        (where.createdAt as Record<string, unknown>).gte = new Date(startTime as string);
      }
      if (endTime) {
        (where.createdAt as Record<string, unknown>).lte = new Date(endTime as string);
      }
    }
    
    if (result) {
      where.result = result;
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, realName: true } }
        },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' }
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        list: logs
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: '获取审计日志失败'
    });
  }
});

router.get('/audit-logs/export', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, action, startTime, endTime, result } = req.query;
    
    const where: Record<string, unknown> = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (action) {
      where.action = { contains: action as string };
    }
    
    if (startTime || endTime) {
      where.createdAt = {};
      if (startTime) {
        (where.createdAt as Record<string, unknown>).gte = new Date(startTime as string);
      }
      if (endTime) {
        (where.createdAt as Record<string, unknown>).lte = new Date(endTime as string);
      }
    }
    
    if (result) {
      where.result = result;
    }

    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { username: true, realName: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10000
    });

    const csvData = logs.map(log => ({
      时间: log.createdAt.toISOString(),
      用户: log.user?.realName || log.user?.username || '系统',
      操作: log.action,
      目标类型: log.targetType || '',
      目标ID: log.targetId || '',
      详情: log.detail || '',
      IP: log.ip || '',
      结果: log.result
    }));

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=audit_logs.json');
    res.json({
      success: true,
      data: csvData
    });
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(500).json({
      success: false,
      message: '导出审计日志失败'
    });
  }
});

router.get('/expired-permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const warningDays = 7;
    const warningDate = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);

    const expiredDataPerms = await prisma.dataPermission.findMany({
      where: {
        deletedAt: null,
        expiresAt: { lte: warningDate }
      },
      include: {
        resource: { select: { id: true, name: true, code: true } }
      }
    });

    const expiredUserPerms = await prisma.userPermission.findMany({
      where: {
        expiresAt: { lte: warningDate }
      },
      include: {
        user: { select: { id: true, username: true, realName: true } },
        permission: { select: { id: true, name: true, code: true } }
      }
    });

    const expiredUserRoles = await prisma.userRole.findMany({
      where: {
        expiresAt: { lte: warningDate }
      },
      include: {
        user: { select: { id: true, username: true, realName: true } },
        role: { select: { id: true, name: true, code: true } }
      }
    });

    const expiredTempAuths = await prisma.tempAuthorization.findMany({
      where: {
        endTime: { lte: warningDate },
        status: 'approved'
      },
      include: {
        user: { select: { id: true, username: true, realName: true } }
      }
    });

    res.json({
      success: true,
      data: {
        dataPermissions: expiredDataPerms.map(p => ({
          ...p,
          isExpired: p.expiresAt && new Date(p.expiresAt) <= now,
          daysUntilExpiry: p.expiresAt 
            ? Math.ceil((new Date(p.expiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
            : null
        })),
        userPermissions: expiredUserPerms.map(p => ({
          ...p,
          isExpired: p.expiresAt && new Date(p.expiresAt) <= now,
          daysUntilExpiry: p.expiresAt 
            ? Math.ceil((new Date(p.expiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
            : null
        })),
        userRoles: expiredUserRoles.map(r => ({
          ...r,
          isExpired: r.expiresAt && new Date(r.expiresAt) <= now,
          daysUntilExpiry: r.expiresAt 
            ? Math.ceil((new Date(r.expiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
            : null
        })),
        tempAuths: expiredTempAuths.map(t => ({
          ...t,
          isExpired: new Date(t.endTime) <= now,
          daysUntilExpiry: Math.ceil((new Date(t.endTime).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        }))
      }
    });
  } catch (error) {
    console.error('Get expired permissions error:', error);
    res.status(500).json({
      success: false,
      message: '获取过期权限失败'
    });
  }
});

router.post('/cleanup-expired', authMiddleware, async (req: Request, res: Response) => {
  try {
    const now = new Date();

    const [dataPerms, userPerms, userRoles, tempAuths] = await Promise.all([
      prisma.dataPermission.updateMany({
        where: { expiresAt: { lte: now } },
        data: { deletedAt: now }
      }),
      prisma.userPermission.deleteMany({
        where: { expiresAt: { lte: now } }
      }),
      prisma.userRole.deleteMany({
        where: { expiresAt: { lte: now } }
      }),
      prisma.tempAuthorization.updateMany({
        where: { endTime: { lte: now }, status: 'approved' },
        data: { status: 'expired' }
      })
    ]);

    res.json({
      success: true,
      data: {
        cleanedDataPermissions: dataPerms.count,
        cleanedUserPermissions: userPerms.count,
        cleanedUserRoles: userRoles.count,
        cleanedTempAuths: tempAuths.count
      },
      message: '过期权限已清理'
    });
  } catch (error) {
    console.error('Cleanup expired error:', error);
    res.status(500).json({
      success: false,
      message: '清理过期权限失败'
    });
  }
});

export default router;