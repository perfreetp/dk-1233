import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { checkPermissionSchema } from '../validators';

const router = Router();

async function getUserPermissions(userId: string): Promise<{
  directPermissions: string[];
  rolePermissions: string[];
  departmentPermissions: string[];
  inheritedDepartmentPermissions: string[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      department: true,
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } }
            }
          }
        }
      },
      permissions: {
        include: { permission: true }
      }
    }
  });

  if (!user) {
    return {
      directPermissions: [],
      rolePermissions: [],
      departmentPermissions: [],
      inheritedDepartmentPermissions: []
    };
  }

  const directPermissions = user.permissions
    .filter(up => !up.expiresAt || new Date(up.expiresAt) > new Date())
    .map(up => up.permission.code);

  const rolePermissions = user.roles
    .filter(ur => !ur.expiresAt || new Date(ur.expiresAt) > new Date())
    .flatMap(ur => ur.role.permissions.map(rp => rp.permission.code));

  const departmentPermissions: string[] = [];
  const inheritedDepartmentPermissions: string[] = [];

  if (user.department) {
    const deptPerms = await prisma.departmentPermission.findMany({
      where: {
        departmentId: user.department.id,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: { permission: true }
    });

    for (const dp of deptPerms) {
      if (dp.inherit) {
        inheritedDepartmentPermissions.push(dp.permission.code);
      } else {
        departmentPermissions.push(dp.permission.code);
      }
    }

    if (user.department.parentId) {
      const parentPerms = await getInheritedDepartmentPermissions(user.department.parentId);
      inheritedDepartmentPermissions.push(...parentPerms);
    }
  }

  return {
    directPermissions,
    rolePermissions,
    departmentPermissions,
    inheritedDepartmentPermissions
  };
}

async function getInheritedDepartmentPermissions(departmentId: string): Promise<string[]> {
  const permissions: string[] = [];
  
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    include: {
      permissions: {
        where: {
          inherit: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        },
        include: { permission: true }
      }
    }
  });

  if (dept) {
    permissions.push(...dept.permissions.map(dp => dp.permission.code));
    
    if (dept.parentId) {
      const parentPerms = await getInheritedDepartmentPermissions(dept.parentId);
      permissions.push(...parentPerms);
    }
  }

  return permissions;
}

router.get('/users/:userId/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    const perms = await getUserPermissions(userId);
    const allPermissions = new Set([
      ...perms.directPermissions,
      ...perms.rolePermissions,
      ...perms.departmentPermissions,
      ...perms.inheritedDepartmentPermissions
    ]);

    const permissionDetails = await prisma.permission.findMany({
      where: {
        code: { in: Array.from(allPermissions) }
      }
    });

    res.json({
      success: true,
      data: {
        userId,
        permissions: permissionDetails,
        sources: {
          direct: perms.directPermissions,
          roles: perms.rolePermissions,
          department: perms.departmentPermissions,
          inherited: perms.inheritedDepartmentPermissions
        }
      }
    });
  } catch (error) {
    console.error('Get user permissions error:', error);
    res.status(500).json({
      success: false,
      message: '获取用户权限失败'
    });
  }
});

router.get('/users/:userId/resources', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { permissionType = 'read' } = req.query;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        department: true,
        roles: {
          include: { role: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const dataPerms = await prisma.dataPermission.findMany({
      where: {
        deletedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ],
        permissionType: { in: [permissionType as string, 'admin'] }
      },
      include: {
        resource: true
      }
    });

    const accessibleResources: Map<string, {
      resource: typeof dataPerms[0]['resource'];
      rowFilter: string | null;
      columnFilter: string | null;
      permissionType: string;
      source: string;
    }> = new Map();

    for (const perm of dataPerms) {
      let hasAccess = false;
      let source = '';

      if (perm.targetType === 'user' && perm.targetId === userId) {
        hasAccess = true;
        source = 'direct';
      } else if (perm.targetType === 'role') {
        const userRoles = user.roles.map(ur => ur.roleId);
        if (userRoles.includes(perm.targetId)) {
          hasAccess = true;
          source = 'role';
        }
      } else if (perm.targetType === 'department') {
        if (user.departmentId === perm.targetId) {
          hasAccess = true;
          source = 'department';
        } else if (user.department?.parentId) {
          const parentDeptIds = await getParentDepartmentIds(user.department.parentId);
          if (parentDeptIds.includes(perm.targetId)) {
            hasAccess = true;
            source = 'inherited_department';
          }
        }
      }

      if (hasAccess && perm.resource) {
        const existing = accessibleResources.get(perm.resource.id);
        if (!existing || perm.priority > (existing.permissionType === 'admin' ? 100 : 0)) {
          accessibleResources.set(perm.resource.id, {
            resource: perm.resource,
            rowFilter: perm.rowFilter,
            columnFilter: perm.columnFilter,
            permissionType: perm.permissionType,
            source
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        userId,
        resources: Array.from(accessibleResources.values())
      }
    });
  } catch (error) {
    console.error('Get user resources error:', error);
    res.status(500).json({
      success: false,
      message: '获取用户可访问资源失败'
    });
  }
});

async function getParentDepartmentIds(departmentId: string): Promise<string[]> {
  const ids: string[] = [];
  let currentId: string | null = departmentId;

  while (currentId) {
    ids.push(currentId);
    const dept = await prisma.department.findUnique({
      where: { id: currentId },
      select: { parentId: true }
    });
    currentId = dept?.parentId;
  }

  return ids;
}

router.get('/resources/:resourceCode/accessors', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { resourceCode } = req.params;
    const { permissionType = 'read' } = req.query;
    
    const resource = await prisma.resource.findUnique({
      where: { code: resourceCode }
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: '资源不存在'
      });
    }

    const dataPerms = await prisma.dataPermission.findMany({
      where: {
        resourceId: resource.id,
        deletedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ],
        permissionType: { in: [permissionType as string, 'admin'] }
      }
    });

    const accessors: {
      users: unknown[];
      roles: unknown[];
      departments: unknown[];
    } = {
      users: [],
      roles: [],
      departments: []
    };

    for (const perm of dataPerms) {
      const accessorInfo = {
        permissionType: perm.permissionType,
        rowFilter: perm.rowFilter,
        columnFilter: perm.columnFilter,
        expiresAt: perm.expiresAt
      };

      if (perm.targetType === 'user') {
        const user = await prisma.user.findUnique({
          where: { id: perm.targetId },
          select: { id: true, username: true, realName: true, department: true }
        });
        if (user) {
          accessors.users.push({ ...user, ...accessorInfo });
        }
      } else if (perm.targetType === 'role') {
        const role = await prisma.role.findUnique({
          where: { id: perm.targetId },
          select: { id: true, name: true, code: true }
        });
        if (role) {
          const usersWithRole = await prisma.userRole.findMany({
            where: { roleId: role.id },
            include: {
              user: {
                select: { id: true, username: true, realName: true }
              }
            }
          });
          accessors.roles.push({
            ...role,
            ...accessorInfo,
            users: usersWithRole.map(ur => ur.user)
          });
        }
      } else if (perm.targetType === 'department') {
        const dept = await prisma.department.findUnique({
          where: { id: perm.targetId },
          select: { id: true, name: true, code: true }
        });
        if (dept) {
          const usersInDept = await prisma.user.findMany({
            where: { departmentId: dept.id, deletedAt: null },
            select: { id: true, username: true, realName: true }
          });
          accessors.departments.push({
            ...dept,
            ...accessorInfo,
            users: usersInDept
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        resource: {
          id: resource.id,
          name: resource.name,
          code: resource.code,
          type: resource.type
        },
        accessors
      }
    });
  } catch (error) {
    console.error('Get resource accessors error:', error);
    res.status(500).json({
      success: false,
      message: '获取资源访问者失败'
    });
  }
});

router.post('/check', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = checkPermissionSchema.parse(req.body);
    
    const resource = await prisma.resource.findUnique({
      where: { code: data.resourceCode }
    });

    if (!resource) {
      return res.json({
        success: true,
        data: {
          allowed: false,
          reason: '资源不存在'
        }
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      include: {
        department: true,
        roles: { include: { role: true } }
      }
    });

    if (!user || user.status !== 1) {
      return res.json({
        success: true,
        data: {
          allowed: false,
          reason: '用户不存在或已禁用'
        }
      });
    }

    const dataPerms = await prisma.dataPermission.findMany({
      where: {
        resourceId: resource.id,
        deletedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: { priority: 'desc' }
    });

    let matchedPerm: typeof dataPerms[0] | null = null;
    let matchSource = '';

    for (const perm of dataPerms) {
      const requiredTypes = [data.permissionType];
      if (data.permissionType === 'read') {
        requiredTypes.push('write', 'admin');
      } else if (data.permissionType === 'write') {
        requiredTypes.push('admin');
      }

      if (!requiredTypes.includes(perm.permissionType)) {
        continue;
      }

      if (perm.targetType === 'user' && perm.targetId === data.userId) {
        matchedPerm = perm;
        matchSource = 'direct';
        break;
      }

      if (perm.targetType === 'role') {
        const userRoleIds = user.roles.map(ur => ur.roleId);
        if (userRoleIds.includes(perm.targetId)) {
          matchedPerm = perm;
          matchSource = 'role';
          break;
        }
      }

      if (perm.targetType === 'department') {
        if (user.departmentId === perm.targetId) {
          matchedPerm = perm;
          matchSource = 'department';
          break;
        }

        if (user.department?.parentId) {
          const parentIds = await getParentDepartmentIds(user.department.parentId);
          if (parentIds.includes(perm.targetId)) {
            matchedPerm = perm;
            matchSource = 'inherited_department';
            break;
          }
        }
      }
    }

    if (matchedPerm) {
      const rowFilter = matchedPerm.rowFilter 
        ? JSON.parse(matchedPerm.rowFilter) 
        : null;
      const columnFilter = matchedPerm.columnFilter 
        ? JSON.parse(matchedPerm.columnFilter) 
        : null;

      if (data.context && rowFilter) {
        const contextMatch = evaluateFilter(rowFilter, data.context);
        if (!contextMatch) {
          await createAlert('unauthorized_access', 'warning', 
            '越权访问尝试', 
            `用户 ${user.username} 尝试访问资源 ${resource.code} 但行级权限不匹配`,
            'user', data.userId);
          
          return res.json({
            success: true,
            data: {
              allowed: false,
              reason: '行级权限限制：数据范围不匹配'
            }
          });
        }
      }

      res.json({
        success: true,
        data: {
          allowed: true,
          permissionType: matchedPerm.permissionType,
          source: matchSource,
          rowFilter,
          columnFilter,
          expiresAt: matchedPerm.expiresAt
        }
      });
    } else {
      await createAlert('unauthorized_access', 'warning',
        '越权访问尝试',
        `用户 ${user.username} 尝试访问资源 ${resource.code} 但无权限`,
        'user', data.userId);

      res.json({
        success: true,
        data: {
          allowed: false,
          reason: '无访问权限'
        }
      });
    }
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({
      success: false,
      message: '权限校验失败'
    });
  }
});

function evaluateFilter(filter: Record<string, unknown>, context: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (context[key] !== value) {
      return false;
    }
  }
  return true;
}

async function createAlert(type: string, level: string, title: string, content: string, targetType: string, targetId: string) {
  try {
    await prisma.alert.create({
      data: {
        type,
        level,
        title,
        content,
        targetType,
        targetId
      }
    });
    console.log(`Alert created: ${type} - ${title}`);
  } catch (error) {
    console.error('Failed to create alert:', error);
  }
}

export default router;