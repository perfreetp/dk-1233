import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { createDataPermissionSchema } from '../validators';

const router = Router();

router.get('/data-permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 20, resourceId, targetType, targetId, permissionType } = req.query;
    
    const where: Record<string, unknown> = { deletedAt: null };
    
    if (resourceId) {
      where.resourceId = resourceId;
    }
    
    if (targetType && targetId) {
      where.targetType = targetType;
      where.targetId = targetId;
    }
    
    if (permissionType) {
      where.permissionType = permissionType;
    }

    const [total, permissions] = await Promise.all([
      prisma.dataPermission.count({ where }),
      prisma.dataPermission.findMany({
        where,
        include: {
          resource: { select: { id: true, name: true, code: true, type: true } }
        },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ]
      })
    ]);

    const enrichedPermissions = await Promise.all(
      permissions.map(async (perm) => {
        let target = null;
        
        if (perm.targetType === 'user') {
          target = await prisma.user.findUnique({
            where: { id: perm.targetId },
            select: { id: true, username: true, realName: true }
          });
        } else if (perm.targetType === 'role') {
          target = await prisma.role.findUnique({
            where: { id: perm.targetId },
            select: { id: true, name: true, code: true }
          });
        } else if (perm.targetType === 'department') {
          target = await prisma.department.findUnique({
            where: { id: perm.targetId },
            select: { id: true, name: true, code: true }
          });
        }
        
        return { ...perm, target };
      })
    );

    res.json({
      success: true,
      data: {
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        list: enrichedPermissions
      }
    });
  } catch (error) {
    console.error('Get data permissions error:', error);
    res.status(500).json({
      success: false,
      message: '获取数据权限列表失败'
    });
  }
});

router.post('/data-permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createDataPermissionSchema.parse(req.body);
    
    const resource = await prisma.resource.findUnique({
      where: { id: data.resourceId }
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: '资源不存在'
      });
    }

    let targetExists = false;
    if (data.targetType === 'user') {
      targetExists = !!(await prisma.user.findUnique({ where: { id: data.targetId } }));
    } else if (data.targetType === 'role') {
      targetExists = !!(await prisma.role.findUnique({ where: { id: data.targetId } }));
    } else if (data.targetType === 'department') {
      targetExists = !!(await prisma.department.findUnique({ where: { id: data.targetId } }));
    }

    if (!targetExists) {
      return res.status(404).json({
        success: false,
        message: '授权目标不存在'
      });
    }

    const permission = await prisma.dataPermission.create({
      data: {
        resourceId: data.resourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        permissionType: data.permissionType,
        rowFilter: data.rowFilter,
        columnFilter: data.columnFilter,
        conditions: data.conditions,
        priority: data.priority,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        createdBy: req.user!.userId
      }
    });

    res.status(201).json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Create data permission error:', error);
    res.status(400).json({
      success: false,
      message: '创建数据权限失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.put('/data-permissions/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rowFilter, columnFilter, conditions, priority, expiresAt } = req.body;

    const permission = await prisma.dataPermission.update({
      where: { id },
      data: {
        rowFilter,
        columnFilter,
        conditions,
        priority,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      }
    });

    res.json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Update data permission error:', error);
    res.status(400).json({
      success: false,
      message: '更新数据权限失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.delete('/data-permissions/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.dataPermission.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    res.json({
      success: true,
      message: '数据权限已删除'
    });
  } catch (error) {
    console.error('Delete data permission error:', error);
    res.status(500).json({
      success: false,
      message: '删除数据权限失败'
    });
  }
});

router.get('/resources/:resourceId/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { resourceId } = req.params;
    
    const permissions = await prisma.dataPermission.findMany({
      where: { 
        resourceId,
        deletedAt: null 
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    const groupedByType = {
      users: [] as unknown[],
      roles: [] as unknown[],
      departments: [] as unknown[]
    };

    for (const perm of permissions) {
      const basePerm = {
        id: perm.id,
        permissionType: perm.permissionType,
        rowFilter: perm.rowFilter,
        columnFilter: perm.columnFilter,
        conditions: perm.conditions,
        priority: perm.priority,
        expiresAt: perm.expiresAt
      };

      if (perm.targetType === 'user') {
        const user = await prisma.user.findUnique({
          where: { id: perm.targetId },
          select: { id: true, username: true, realName: true }
        });
        if (user) {
          groupedByType.users.push({ ...basePerm, target: user });
        }
      } else if (perm.targetType === 'role') {
        const role = await prisma.role.findUnique({
          where: { id: perm.targetId },
          select: { id: true, name: true, code: true }
        });
        if (role) {
          groupedByType.roles.push({ ...basePerm, target: role });
        }
      } else if (perm.targetType === 'department') {
        const dept = await prisma.department.findUnique({
          where: { id: perm.targetId },
          select: { id: true, name: true, code: true }
        });
        if (dept) {
          groupedByType.departments.push({ ...basePerm, target: dept });
        }
      }
    }

    res.json({
      success: true,
      data: groupedByType
    });
  } catch (error) {
    console.error('Get resource permissions error:', error);
    res.status(500).json({
      success: false,
      message: '获取资源权限失败'
    });
  }
});

export default router;