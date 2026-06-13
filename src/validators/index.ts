import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100)
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  realName: z.string().min(2).max(50),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  departmentId: z.string().uuid().optional()
});

export const updateUserSchema = z.object({
  realName: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  departmentId: z.string().uuid().optional().nullable(),
  status: z.number().int().min(0).max(1).optional()
});

export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  code: z.string().min(2).max(50),
  description: z.string().max(500).optional(),
  type: z.enum(['system', 'custom']).default('custom')
});

export const updateRoleSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(500).optional(),
  status: z.number().int().min(0).max(1).optional()
});

export const createPermissionSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(100),
  type: z.enum(['resource', 'operation', 'data']).default('resource'),
  description: z.string().max(500).optional()
});

export const createResourceSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(100),
  type: z.enum(['report', 'api', 'analysis', 'other']).default('report'),
  categoryId: z.string().uuid().optional(),
  description: z.string().max(1000).optional(),
  config: z.string().optional()
});

export const updateResourceSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  description: z.string().max(1000).optional(),
  config: z.string().optional(),
  status: z.number().int().min(0).max(1).optional()
});

export const createDepartmentSchema = z.object({
  name: z.string().min(2).max(50),
  code: z.string().min(2).max(50),
  parentId: z.string().uuid().optional()
});

export const updateDepartmentSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  parentId: z.string().uuid().optional().nullable()
});

export const createDataPermissionSchema = z.object({
  resourceId: z.string().uuid(),
  targetType: z.enum(['user', 'role', 'department']),
  targetId: z.string().uuid(),
  permissionType: z.enum(['read', 'write', 'admin']).default('read'),
  rowFilter: z.string().optional(),
  columnFilter: z.string().optional(),
  conditions: z.string().optional(),
  priority: z.number().int().default(0),
  expiresAt: z.string().datetime().optional()
});

export const createTempAuthSchema = z.object({
  resourceCode: z.string().min(1),
  permissionType: z.enum(['read', 'write', 'admin']).default('read'),
  reason: z.string().max(500).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime()
});

export const createAuthRequestSchema = z.object({
  resourceCode: z.string().min(1),
  requestType: z.enum(['access', 'temp', 'permanent']).default('access'),
  reason: z.string().max(1000).optional(),
  rowFilter: z.string().optional(),
  columnFilter: z.string().optional(),
  duration: z.number().int().positive().optional()
});

export const approvalActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(500).optional()
});

export const batchPermissionSchema = z.object({
  departmentId: z.string().uuid(),
  permissionIds: z.array(z.string().uuid()),
  inherit: z.boolean().default(true),
  expiresAt: z.string().datetime().optional()
});

export const checkPermissionSchema = z.object({
  userId: z.string().uuid(),
  resourceCode: z.string(),
  permissionType: z.enum(['read', 'write', 'admin']).default('read'),
  context: z.record(z.unknown()).optional()
});