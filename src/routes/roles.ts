import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { createRoleSchema, updateRoleSchema, createPermissionSchema } from '../validators';

const router = Router();

router.get('/roles', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 20, keyword, type, status } = req.query;
    
    const where: Record<string, unknown> = { deletedAt: null };
    
    if (keyword) {
      where.OR = [
        { name: { contains: keyword as string } },
        { code: { contains: keyword as string } }
      ];
    }
    
    if (type) {
      where.type = type;
    }
    
    if (status !== undefined) {
      where.status = Number(status);
    }

    const [total, roles] = await Promise.all([
      prisma.role.count({ where }),
      prisma.role.findMany({
        where,
        include: {
          permissions: {
            include: { permission: true }
          },
          _count: {
            select: { users: true }
          }
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
        list: roles.map(r => ({
          id: r.id,
          name: r.name,
          code: r.code,
          description: r.description,
          type: r.type,
          status: r.status,
          permissions: r.permissions.map(p => p.permission),
          userCount: r._count.users,
          createdAt: r.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({
      success: false,
      message: '获取角色列表失败'
    });
  }
});

router.get('/roles/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: { permission: true }
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                realName: true
              }
            }
          }
        }
      }
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: '角色不存在'
      });
    }

    res.json({
      success: true,
      data: {
        ...role,
        permissions: role.permissions.map(p => p.permission),
        users: role.users.map(u => ({
          ...u.user,
          expiresAt: u.expiresAt
        }))
      }
    });
  } catch (error) {
    console.error('Get role error:', error);
    res.status(500).json({
      success: false,
      message: '获取角色详情失败'
    });
  }
});

router.post('/roles', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createRoleSchema.parse(req.body);
    
    const existing = await prisma.role.findFirst({
      where: {
        OR: [
          { name: data.name },
          { code: data.code }
        ]
      }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '角色名称或编码已存在'
      });
    }

    const role = await prisma.role.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        type: data.type
      }
    });

    res.status(201).json({
      success: true,
      data: role
    });
  } catch (error) {
    console.error('Create role error:', error);
    res.status(400).json({
      success: false,
      message: '创建角色失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.put('/roles/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = updateRoleSchema.parse(req.body);

    const role = await prisma.role.update({
      where: { id },
      data
    });

    res.json({
      success: true,
      data: role
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(400).json({
      success: false,
      message: '更新角色失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.delete('/roles/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.userRole.deleteMany({ where: { roleId: id } }),
      prisma.role.update({
        where: { id },
        data: { deletedAt: new Date() }
      })
    ]);

    res.json({
      success: true,
      message: '角色已删除'
    });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({
      success: false,
      message: '删除角色失败'
    });
  }
});

router.post('/roles/:id/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { permissionIds } = req.body;

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({
        success: false,
        message: 'permissionIds 必须是数组'
      });
    }

    await prisma.rolePermission.deleteMany({ where: { roleId: id } });
    
    if (permissionIds.length > 0) {
      await prisma.$transaction(
        permissionIds.map(permissionId =>
          prisma.rolePermission.create({
            data: { roleId: id, permissionId }
          })
        )
      );
    }

    res.json({
      success: true,
      message: '权限分配成功'
    });
  } catch (error) {
    console.error('Assign permissions to role error:', error);
    res.status(500).json({
      success: false,
      message: '分配权限失败'
    });
  }
});

router.get('/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type, status } = req.query;
    
    const where: Record<string, unknown> = { deletedAt: null };
    
    if (type) {
      where.type = type;
    }
    
    if (status !== undefined) {
      where.status = Number(status);
    }

    const permissions = await prisma.permission.findMany({
      where,
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }]
    });

    res.json({
      success: true,
      data: permissions
    });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({
      success: false,
      message: '获取权限列表失败'
    });
  }
});

router.post('/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createPermissionSchema.parse(req.body);
    
    const existing = await prisma.permission.findUnique({
      where: { code: data.code }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '权限编码已存在'
      });
    }

    const permission = await prisma.permission.create({
      data: {
        name: data.name,
        code: data.code,
        type: data.type,
        description: data.description
      }
    });

    res.status(201).json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Create permission error:', error);
    res.status(400).json({
      success: false,
      message: '创建权限失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.delete('/permissions/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { permissionId: id } }),
      prisma.userPermission.deleteMany({ where: { permissionId: id } }),
      prisma.departmentPermission.deleteMany({ where: { permissionId: id } }),
      prisma.permission.update({
        where: { id },
        data: { deletedAt: new Date() }
      })
    ]);

    res.json({
      success: true,
      message: '权限已删除'
    });
  } catch (error) {
    console.error('Delete permission error:', error);
    res.status(500).json({
      success: false,
      message: '删除权限失败'
    });
  }
});

export default router;