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

  const now = new Date();
  const directPermissions = user.permissions
    .filter(up => !up.expiresAt || new Date(up.expiresAt) > now)
    .map(up => up.permission.code);

  const rolePermissions = user.roles
    .filter(ur => !ur.expiresAt || new Date(ur.expiresAt) > now)
    .flatMap(ur => ur.role.permissions.map(rp => rp.permission.code));

  const departmentPermissions: string[] = [];
  const inheritedDepartmentPermissions: string[] = [];

  if (user.department) {
    const deptPerms = await prisma.departmentPermission.findMany({
      where: {
        departmentId: user.department.id,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
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

    const now = new Date();
    const dataPerms = await prisma.dataPermission.findMany({
      where: {
        deletedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ],
        permissionType: { in: [permissionType as string, 'admin'] }
      },
      include: {
        resource: true
      }
    });

    const tempAuths = await prisma.tempAuthorization.findMany({
      where: {
        userId,
        status: 'approved',
        startTime: { lte: now },
        endTime: { gt: now }
      }
    });

    const accessibleResources: Map<string, {
      resource: { id: string; name: string; code: string; type: string; status: number };
      rowFilter: string | null;
      columnFilter: string | null;
      permissionType: string;
      source: string;
      startTime?: Date;
      endTime?: Date;
      isTempAuth?: boolean;
    }> = new Map();

    for (const perm of dataPerms) {
      if (!perm.resource) continue;
      
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
        const existingPriority = existing ? (existing.permissionType === 'admin' ? 100 : 0) : -1;
        if (!existing || perm.priority > existingPriority) {
          accessibleResources.set(perm.resource.id, {
            resource: {
              id: perm.resource.id,
              name: perm.resource.name,
              code: perm.resource.code,
              type: perm.resource.type,
              status: perm.resource.status
            },
            rowFilter: perm.rowFilter,
            columnFilter: perm.columnFilter,
            permissionType: perm.permissionType,
            source
          });
        }
      }
    }

    for (const tempAuth of tempAuths) {
      const resource = await prisma.resource.findUnique({
        where: { code: tempAuth.resourceCode }
      });
      if (resource && !accessibleResources.has(resource.id)) {
        accessibleResources.set(resource.id, {
          resource: {
            id: resource.id,
            name: resource.name,
            code: resource.code,
            type: resource.type,
            status: resource.status
          },
          rowFilter: null,
          columnFilter: null,
          permissionType: tempAuth.permissionType,
          source: 'temp_auth',
          startTime: tempAuth.startTime,
          endTime: tempAuth.endTime,
          isTempAuth: true
        });
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
    currentId = dept?.parentId || null;
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
    const parseResult = checkPermissionSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => e.message).join(', ');
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors
      });
    }
    
    const data = parseResult.data;
    
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

    const now = new Date();
    const dataPerms = await prisma.dataPermission.findMany({
      where: {
        resourceId: resource.id,
        deletedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      orderBy: { priority: 'desc' }
    });

    const tempAuth = await prisma.tempAuthorization.findFirst({
      where: {
        userId: data.userId,
        resourceCode: data.resourceCode,
        status: 'approved',
        startTime: { lte: now },
        endTime: { gt: now }
      }
    });

    let matchedPerm: typeof dataPerms[0] | null = null;
    let matchSource = '';
    let isTempAuth = false;

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
      let rowFilter: Record<string, unknown> | null = null;
      let columnFilter: Record<string, unknown> | null = null;

      try {
        if (matchedPerm.rowFilter) {
          rowFilter = JSON.parse(matchedPerm.rowFilter);
        }
      } catch {
        rowFilter = null;
      }

      try {
        if (matchedPerm.columnFilter) {
          columnFilter = JSON.parse(matchedPerm.columnFilter);
        }
      } catch {
        columnFilter = null;
      }

      if (data.context && rowFilter) {
        const contextMatch = evaluateFilter(rowFilter, data.context);
        if (!contextMatch) {
          await createAlert('unauthorized_access', 'warning', 
            '越权访问尝试', 
            `用户 ${escapeHtml(user.username)} 尝试访问资源 ${escapeHtml(resource.code)} 但行级权限不匹配`,
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
      if (tempAuth) {
        if (data.permissionType !== 'admin' && tempAuth.permissionType === 'admin') {
          res.json({
            success: true,
            data: {
              allowed: true,
              permissionType: tempAuth.permissionType,
              source: 'temp_auth',
              rowFilter: null,
              columnFilter: null,
              expiresAt: tempAuth.endTime,
              startTime: tempAuth.startTime,
              isTempAuth: true
            }
          });
        } else {
          res.json({
            success: true,
            data: {
              allowed: false,
              reason: '临时授权权限级别不足'
            }
          });
        }
      } else {
        const pendingTempAuth = await prisma.tempAuthorization.findFirst({
          where: {
            userId: data.userId,
            resourceCode: data.resourceCode,
            status: 'pending'
          }
        });

        if (pendingTempAuth) {
          if (now < pendingTempAuth.startTime) {
            res.json({
              success: true,
              data: {
                allowed: false,
                reason: `临时授权尚未开始，开始时间：${pendingTempAuth.startTime.toLocaleString()}`
              }
            });
          } else if (now > pendingTempAuth.endTime) {
            res.json({
              success: true,
              data: {
                allowed: false,
                reason: '临时授权已过期'
              }
            });
          } else {
            res.json({
              success: true,
              data: {
                allowed: false,
                reason: '临时授权待审批'
              }
            });
          }
        } else {
          await createAlert('unauthorized_access', 'warning',
            '越权访问尝试',
            `用户 ${escapeHtml(user.username)} 尝试访问资源 ${escapeHtml(resource.code)} 但无权限`,
            'user', data.userId);

          res.json({
            success: true,
            data: {
              allowed: false,
              reason: '无访问权限'
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({
      success: false,
      message: '权限校验失败'
    });
  }
});

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

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
        title: escapeHtml(title),
        content: escapeHtml(content),
        targetType,
        targetId
      }
    });
  } catch (error) {
    console.error('Failed to create alert:', error);
  }
}

export default router;