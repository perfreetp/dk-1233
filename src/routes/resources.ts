import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { createResourceSchema, updateResourceSchema, createDepartmentSchema, updateDepartmentSchema } from '../validators';

const router = Router();

router.get('/departments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      where: { deletedAt: null },
      include: {
        _count: { select: { users: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    const buildTree = (items: typeof departments, parentId: string | null = null): unknown[] => {
      return items
        .filter(item => item.parentId === parentId)
        .map(item => ({
          ...item,
          userCount: item._count.users,
          children: buildTree(items, item.id)
        }));
    };

    res.json({
      success: true,
      data: buildTree(departments)
    });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({
      success: false,
      message: '获取部门列表失败'
    });
  }
});

router.get('/departments/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const department = await prisma.department.findUnique({
      where: { id },
      include: {
        parent: true,
        children: { where: { deletedAt: null } },
        users: {
          where: { deletedAt: null },
          select: { id: true, username: true, realName: true }
        },
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

    res.json({
      success: true,
      data: {
        ...department,
        permissions: department.permissions.map(p => ({
          ...p.permission,
          inherit: p.inherit,
          expiresAt: p.expiresAt
        }))
      }
    });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({
      success: false,
      message: '获取部门详情失败'
    });
  }
});

router.post('/departments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createDepartmentSchema.parse(req.body);
    
    const existing = await prisma.department.findUnique({
      where: { code: data.code }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '部门编码已存在'
      });
    }

    const department = await prisma.department.create({
      data: {
        name: data.name,
        code: data.code,
        parentId: data.parentId
      }
    });

    res.status(201).json({
      success: true,
      data: department
    });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(400).json({
      success: false,
      message: '创建部门失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.put('/departments/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = updateDepartmentSchema.parse(req.body);

    if (data.parentId === id) {
      return res.status(400).json({
        success: false,
        message: '不能将自己设为父部门'
      });
    }

    const department = await prisma.department.update({
      where: { id },
      data
    });

    res.json({
      success: true,
      data: department
    });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(400).json({
      success: false,
      message: '更新部门失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.delete('/departments/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const children = await prisma.department.count({
      where: { parentId: id, deletedAt: null }
    });

    if (children > 0) {
      return res.status(400).json({
        success: false,
        message: '存在子部门，无法删除'
      });
    }

    const users = await prisma.user.count({
      where: { departmentId: id, deletedAt: null }
    });

    if (users > 0) {
      return res.status(400).json({
        success: false,
        message: '部门下存在用户，无法删除'
      });
    }

    await prisma.department.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    res.json({
      success: true,
      message: '部门已删除'
    });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({
      success: false,
      message: '删除部门失败'
    });
  }
});

router.get('/categories', authMiddleware, async (req: Request, res: Response) => {
  try {
    const categories = await prisma.resourceCategory.findMany({
      where: { deletedAt: null },
      include: {
        _count: { select: { resources: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    const buildTree = (items: typeof categories, parentId: string | null = null): unknown[] => {
      return items
        .filter(item => item.parentId === parentId)
        .map(item => ({
          ...item,
          resourceCount: item._count.resources,
          children: buildTree(items, item.id)
        }));
    };

    res.json({
      success: true,
      data: buildTree(categories)
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: '获取资源分类列表失败'
    });
  }
});

router.post('/categories', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, code, parentId } = req.body;
    
    const existing = await prisma.resourceCategory.findUnique({
      where: { code }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '分类编码已存在'
      });
    }

    const category = await prisma.resourceCategory.create({
      data: { name, code, parentId }
    });

    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(400).json({
      success: false,
      message: '创建资源分类失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.delete('/categories/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const children = await prisma.resourceCategory.count({
      where: { parentId: id, deletedAt: null }
    });

    if (children > 0) {
      return res.status(400).json({
        success: false,
        message: '存在子分类，无法删除'
      });
    }

    const resources = await prisma.resource.count({
      where: { categoryId: id, deletedAt: null }
    });

    if (resources > 0) {
      return res.status(400).json({
        success: false,
        message: '分类下存在资源，无法删除'
      });
    }

    await prisma.resourceCategory.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    res.json({
      success: true,
      message: '资源分类已删除'
    });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({
      success: false,
      message: '删除资源分类失败'
    });
  }
});

router.get('/resources', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 20, keyword, type, categoryId, status } = req.query;
    
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
    
    if (categoryId) {
      where.categoryId = categoryId;
    }
    
    if (status !== undefined) {
      where.status = Number(status);
    }

    const [total, resources] = await Promise.all([
      prisma.resource.count({ where }),
      prisma.resource.findMany({
        where,
        include: {
          category: true,
          _count: { select: { dataPermissions: true } }
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
        list: resources.map(r => ({
          ...r,
          permissionCount: r._count.dataPermissions
        }))
      }
    });
  } catch (error) {
    console.error('Get resources error:', error);
    res.status(500).json({
      success: false,
      message: '获取资源列表失败'
    });
  }
});

router.get('/resources/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        category: true,
        dataPermissions: {
          where: { deletedAt: null },
          include: {
            resource: { select: { id: true, name: true, code: true } }
          }
        }
      }
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: '资源不存在'
      });
    }

    res.json({
      success: true,
      data: resource
    });
  } catch (error) {
    console.error('Get resource error:', error);
    res.status(500).json({
      success: false,
      message: '获取资源详情失败'
    });
  }
});

router.post('/resources', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createResourceSchema.parse(req.body);
    
    const existing = await prisma.resource.findUnique({
      where: { code: data.code }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '资源编码已存在'
      });
    }

    const resource = await prisma.resource.create({
      data: {
        name: data.name,
        code: data.code,
        type: data.type,
        categoryId: data.categoryId,
        description: data.description,
        config: data.config
      }
    });

    res.status(201).json({
      success: true,
      data: resource
    });
  } catch (error) {
    console.error('Create resource error:', error);
    res.status(400).json({
      success: false,
      message: '创建资源失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.put('/resources/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = updateResourceSchema.parse(req.body);

    const resource = await prisma.resource.update({
      where: { id },
      data
    });

    res.json({
      success: true,
      data: resource
    });
  } catch (error) {
    console.error('Update resource error:', error);
    res.status(400).json({
      success: false,
      message: '更新资源失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.delete('/resources/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.$transaction([
      prisma.dataPermission.updateMany({
        where: { resourceId: id },
        data: { deletedAt: new Date() }
      }),
      prisma.resource.update({
        where: { id },
        data: { deletedAt: new Date() }
      })
    ]);

    res.json({
      success: true,
      message: '资源已删除'
    });
  } catch (error) {
    console.error('Delete resource error:', error);
    res.status(500).json({
      success: false,
      message: '删除资源失败'
    });
  }
});

export default router;