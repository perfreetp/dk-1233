import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { hashPassword, comparePassword, generateToken } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { loginSchema, createUserSchema, updateUserSchema } from '../validators';

const router = Router();

function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        roles: {
          include: { role: true }
        },
        department: true
      }
    });

    if (!user || user.status !== 1) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    if (!comparePassword(password, user.password)) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    const roles = user.roles.map(ur => ur.role.code);
    const token = generateToken({
      userId: user.id,
      username: user.username,
      roles
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          realName: escapeHtml(user.realName),
          email: escapeHtml(user.email || ''),
          phone: user.phone ? '***' + user.phone.slice(-4) : null,
          department: user.department ? {
            id: user.department.id,
            name: escapeHtml(user.department.name),
            code: escapeHtml(user.department.code)
          } : null,
          roles: user.roles.map(ur => ({
            id: ur.role.id,
            name: escapeHtml(ur.role.name),
            code: escapeHtml(ur.role.code)
          }))
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).json({
      success: false,
      message: '登录失败'
    });
  }
});

router.get('/profile', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        roles: {
          include: { role: true }
        },
        department: true,
        permissions: {
          include: { permission: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        realName: escapeHtml(user.realName),
        email: escapeHtml(user.email || ''),
        phone: user.phone ? '***' + user.phone.slice(-4) : null,
        department: user.department ? {
          id: user.department.id,
          name: escapeHtml(user.department.name),
          code: escapeHtml(user.department.code)
        } : null,
        roles: user.roles.map(ur => ({
          id: ur.role.id,
          name: escapeHtml(ur.role.name),
          code: escapeHtml(ur.role.code),
          expiresAt: ur.expiresAt
        })),
        permissions: user.permissions.map(up => ({
          id: up.permission.id,
          name: escapeHtml(up.permission.name),
          code: up.permission.code,
          type: up.permission.type,
          source: up.source,
          expiresAt: up.expiresAt
        }))
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

router.get('/users', authMiddleware, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const keyword = req.query.keyword as string;
    const departmentId = req.query.departmentId as string;
    const status = req.query.status as string;
    
    const where: Record<string, unknown> = { deletedAt: null };
    
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { realName: { contains: keyword } },
        { email: { contains: keyword } }
      ];
    }
    
    if (departmentId) {
      where.departmentId = departmentId;
    }
    
    if (status !== undefined) {
      where.status = parseInt(status);
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: {
          department: true,
          roles: {
            include: { role: true }
          }
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        page,
        pageSize,
        list: users.map(u => ({
          id: u.id,
          username: u.username,
          realName: escapeHtml(u.realName),
          email: escapeHtml(u.email || ''),
          phone: u.phone ? '***' + u.phone.slice(-4) : null,
          status: u.status,
          department: u.department ? {
            id: u.department.id,
            name: escapeHtml(u.department.name),
            code: escapeHtml(u.department.code)
          } : null,
          roles: u.roles.map(r => ({
            id: r.role.id,
            name: escapeHtml(r.role.name),
            code: escapeHtml(r.role.code)
          })),
          createdAt: u.createdAt,
          updatedAt: u.updatedAt
        }))
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: '获取用户列表失败'
    });
  }
});

router.post('/users', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createUserSchema.parse(req.body);
    
    const existing = await prisma.user.findUnique({
      where: { username: data.username }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '用户名已存在'
      });
    }

    const user = await prisma.user.create({
      data: {
        username: data.username,
        password: hashPassword(data.password),
        realName: data.realName,
        email: data.email,
        phone: data.phone,
        departmentId: data.departmentId
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        realName: escapeHtml(user.realName),
        email: escapeHtml(user.email || '')
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(400).json({
      success: false,
      message: '创建用户失败'
    });
  }
});

router.put('/users/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const user = await prisma.user.update({
      where: { id },
      data
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        realName: escapeHtml(user.realName),
        email: escapeHtml(user.email || ''),
        status: user.status
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(400).json({
      success: false,
      message: '更新用户失败'
    });
  }
});

router.delete('/users/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.user.findUnique({ 
      where: { id, deletedAt: null } 
    });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    res.json({
      success: true,
      message: '用户已删除'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: '删除用户失败'
    });
  }
});

router.post('/users/:id/roles', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { roleIds, expiresAt } = req.body;

    if (!Array.isArray(roleIds)) {
      return res.status(400).json({
        success: false,
        message: 'roleIds 必须是数组'
      });
    }

    const user = await prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const validRoleIds = roleIds.filter((id: string) => typeof id === 'string' && id.length > 0);
    if (validRoleIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'roleIds 不能为空'
      });
    }

    await prisma.$transaction(
      validRoleIds.map(roleId => 
        prisma.userRole.upsert({
          where: { userId_roleId: { userId: id, roleId } },
          create: {
            userId: id,
            roleId,
            expiresAt: expiresAt ? new Date(expiresAt) : null
          },
          update: {
            expiresAt: expiresAt ? new Date(expiresAt) : null
          }
        })
      )
    );

    res.json({
      success: true,
      message: '角色分配成功'
    });
  } catch (error) {
    console.error('Assign roles error:', error);
    res.status(500).json({
      success: false,
      message: '分配角色失败'
    });
  }
});

router.post('/users/:id/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { permissionIds, expiresAt } = req.body;

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({
        success: false,
        message: 'permissionIds 必须是数组'
      });
    }

    const user = await prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const validPermissionIds = permissionIds.filter((id: string) => typeof id === 'string' && id.length > 0);
    if (validPermissionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'permissionIds 不能为空'
      });
    }

    await prisma.$transaction(
      validPermissionIds.map(permissionId =>
        prisma.userPermission.upsert({
          where: { userId_permissionId: { userId: id, permissionId } },
          create: {
            userId: id,
            permissionId,
            source: 'direct',
            expiresAt: expiresAt ? new Date(expiresAt) : null
          },
          update: {
            expiresAt: expiresAt ? new Date(expiresAt) : null
          }
        })
      )
    );

    res.json({
      success: true,
      message: '权限分配成功'
    });
  } catch (error) {
    console.error('Assign permissions error:', error);
    res.status(500).json({
      success: false,
      message: '分配权限失败'
    });
  }
});

export default router;