import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { createTempAuthSchema, createAuthRequestSchema, approvalActionSchema } from '../validators';

const router = Router();

router.get('/temp-auths', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 20, userId, resourceCode, status } = req.query;
    
    const where: Record<string, unknown> = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (resourceCode) {
      where.resourceCode = resourceCode;
    }
    
    if (status) {
      where.status = status;
    }

    const [total, tempAuths] = await Promise.all([
      prisma.tempAuthorization.count({ where }),
      prisma.tempAuthorization.findMany({
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
        list: tempAuths
      }
    });
  } catch (error) {
    console.error('Get temp auths error:', error);
    res.status(500).json({
      success: false,
      message: '获取临时授权列表失败'
    });
  }
});

router.post('/temp-auths', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createTempAuthSchema.parse(req.body);
    
    const resource = await prisma.resource.findUnique({
      where: { code: data.resourceCode }
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: '资源不存在'
      });
    }

    if (new Date(data.endTime) <= new Date(data.startTime)) {
      return res.status(400).json({
        success: false,
        message: '结束时间必须大于开始时间'
      });
    }

    const approvalFlow = await prisma.approvalFlow.findFirst({
      where: { type: 'authorization', status: 1, deletedAt: null },
      include: { nodes: { orderBy: { order: 'asc' } } }
    });

    const initialNodeId = approvalFlow?.nodes[0]?.id || null;

    const tempAuth = await prisma.tempAuthorization.create({
      data: {
        userId: req.user!.userId,
        resourceCode: data.resourceCode,
        permissionType: data.permissionType,
        reason: data.reason,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        status: approvalFlow ? 'pending' : 'approved',
        approvalFlowId: approvalFlow?.id,
        currentNodeId: initialNodeId
      }
    });

    if (!approvalFlow) {
      await prisma.dataPermission.create({
        data: {
          resourceId: resource.id,
          targetType: 'user',
          targetId: req.user!.userId,
          permissionType: data.permissionType,
          expiresAt: new Date(data.endTime),
          createdBy: req.user!.userId
        }
      });
    }

    res.status(201).json({
      success: true,
      data: tempAuth,
      message: approvalFlow ? '临时授权申请已提交，等待审批' : '临时授权已创建'
    });
  } catch (error) {
    console.error('Create temp auth error:', error);
    res.status(400).json({
      success: false,
      message: '创建临时授权失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.get('/auth-requests', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 20, userId, resourceCode, status } = req.query;
    
    const where: Record<string, unknown> = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (resourceCode) {
      where.resourceCode = resourceCode;
    }
    
    if (status) {
      where.status = status;
    }

    const [total, requests] = await Promise.all([
      prisma.authorizationRequest.count({ where }),
      prisma.authorizationRequest.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, realName: true } },
          resource: { select: { id: true, name: true, code: true } }
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
        list: requests
      }
    });
  } catch (error) {
    console.error('Get auth requests error:', error);
    res.status(500).json({
      success: false,
      message: '获取授权申请列表失败'
    });
  }
});

router.post('/auth-requests', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = createAuthRequestSchema.parse(req.body);
    
    const resource = await prisma.resource.findUnique({
      where: { code: data.resourceCode }
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: '资源不存在'
      });
    }

    const approvalFlow = await prisma.approvalFlow.findFirst({
      where: { type: 'authorization', status: 1, deletedAt: null },
      include: { nodes: { orderBy: { order: 'asc' } } }
    });

    const initialNodeId = approvalFlow?.nodes[0]?.id || null;

    const authRequest = await prisma.authorizationRequest.create({
      data: {
        userId: req.user!.userId,
        resourceCode: data.resourceCode,
        resourceId: resource.id,
        requestType: data.requestType,
        permissionType: data.permissionType,
        reason: data.reason,
        rowFilter: data.rowFilter,
        columnFilter: data.columnFilter,
        duration: data.duration,
        status: 'pending',
        approvalFlowId: approvalFlow?.id,
        currentNodeId: initialNodeId
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...authRequest,
        currentNode: approvalFlow?.nodes[0] || null,
        totalNodes: approvalFlow?.nodes.length || 0
      },
      message: approvalFlow 
        ? `授权申请已提交，等待${approvalFlow.nodes[0]?.name || '审批'}审批`
        : '授权申请已提交'
    });
  } catch (error) {
    console.error('Create auth request error:', error);
    res.status(400).json({
      success: false,
      message: '创建授权申请失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.post('/auth-requests/:id/approve', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = approvalActionSchema.parse(req.body);
    
    const authRequest = await prisma.authorizationRequest.findUnique({
      where: { id },
      include: {
        resource: true,
        approvalFlow: {
          include: { nodes: { orderBy: { order: 'asc' } } }
        },
        currentNode: true
      }
    });

    if (!authRequest) {
      return res.status(404).json({
        success: false,
        message: '授权申请不存在'
      });
    }

    if (authRequest.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: '该申请已通过审批'
      });
    }

    if (authRequest.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: '该申请已被拒绝'
      });
    }

    const existingRecord = await prisma.approvalRecord.findFirst({
      where: {
        nodeId: authRequest.currentNodeId,
        targetType: 'auth_request',
        targetId: id,
        approverId: req.user!.userId
      }
    });

    if (existingRecord) {
      return res.status(400).json({
        success: false,
        message: '您已在当前节点审批过此申请'
      });
    }

    if (data.action === 'reject') {
      await prisma.$transaction(async (tx) => {
        await tx.approvalRecord.create({
          data: {
            nodeId: authRequest.currentNodeId || '',
            approverId: req.user!.userId,
            targetType: 'auth_request',
            targetId: id,
            action: 'reject',
            comment: data.comment
          }
        });

        await tx.authorizationRequest.update({
          where: { id },
          data: { status: 'rejected' }
        });
      });

      await prisma.alert.create({
        data: {
          type: 'approval',
          level: 'info',
          title: '授权申请已拒绝',
          content: `用户 ${authRequest.userId} 对资源 ${authRequest.resourceCode} 的访问申请已被拒绝`,
          targetType: 'auth_request',
          targetId: id
        }
      });

      return res.json({
        success: true,
        message: '授权申请已拒绝'
      });
    }

    await prisma.approvalRecord.create({
      data: {
        nodeId: authRequest.currentNodeId || '',
        approverId: req.user!.userId,
        targetType: 'auth_request',
        targetId: id,
        action: 'approve',
        comment: data.comment
      }
    });

    const nodes = authRequest.approvalFlow?.nodes || [];
    const currentNodeIndex = nodes.findIndex(n => n.id === authRequest.currentNodeId);
    const isLastNode = currentNodeIndex === nodes.length - 1 || currentNodeIndex === -1;

    if (isLastNode) {
      if (authRequest.resource) {
        let expiresAt = authRequest.duration 
          ? new Date(Date.now() + authRequest.duration * 1000)
          : null;
        
        if (authRequest.requestType === 'permanent') {
          expiresAt = null;
        }

        await prisma.dataPermission.create({
          data: {
            resourceId: authRequest.resource.id,
            targetType: 'user',
            targetId: authRequest.userId,
            permissionType: authRequest.permissionType,
            rowFilter: authRequest.rowFilter,
            columnFilter: authRequest.columnFilter,
            expiresAt,
            createdBy: req.user!.userId
          }
        });
      }

      await prisma.authorizationRequest.update({
        where: { id },
        data: { status: 'approved', currentNodeId: null }
      });

      await prisma.alert.create({
        data: {
          type: 'approval',
          level: 'info',
          title: '授权申请已通过全部审批',
          content: `用户 ${authRequest.userId} 对资源 ${authRequest.resourceCode} 的访问申请已通过全部审批`,
          targetType: 'auth_request',
          targetId: id
        }
      });

      return res.json({
        success: true,
        message: '授权申请已通过全部审批，权限已生效'
      });
    }

    const nextNode = nodes[currentNodeIndex + 1];
    await prisma.authorizationRequest.update({
      where: { id },
      data: { currentNodeId: nextNode.id }
    });

    res.json({
      success: true,
      message: `已通过${nodes[currentNodeIndex]?.name || '当前'}节点审批，等待${nextNode.name}审批`,
      data: {
        currentNode: nextNode,
        completedNodes: currentNodeIndex + 1,
        totalNodes: nodes.length
      }
    });
  } catch (error) {
    console.error('Approve auth request error:', error);
    res.status(400).json({
      success: false,
      message: '处理授权申请失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.post('/temp-auths/:id/approve', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = approvalActionSchema.parse(req.body);
    
    const tempAuth = await prisma.tempAuthorization.findUnique({
      where: { id },
      include: {
        approvalFlow: {
          include: { nodes: { orderBy: { order: 'asc' } } }
        },
        currentNode: true
      }
    });

    if (!tempAuth) {
      return res.status(404).json({
        success: false,
        message: '临时授权不存在'
      });
    }

    if (tempAuth.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: '该临时授权已通过审批'
      });
    }

    if (tempAuth.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: '该临时授权已被拒绝'
      });
    }

    const existingRecord = await prisma.approvalRecord.findFirst({
      where: {
        nodeId: tempAuth.currentNodeId,
        targetType: 'temp_auth',
        targetId: id,
        approverId: req.user!.userId
      }
    });

    if (existingRecord) {
      return res.status(400).json({
        success: false,
        message: '您已在当前节点审批过此申请'
      });
    }

    if (data.action === 'reject') {
      await prisma.$transaction(async (tx) => {
        await tx.approvalRecord.create({
          data: {
            nodeId: tempAuth.currentNodeId || '',
            approverId: req.user!.userId,
            targetType: 'temp_auth',
            targetId: id,
            action: 'reject',
            comment: data.comment
          }
        });

        await tx.tempAuthorization.update({
          where: { id },
          data: { status: 'rejected' }
        });
      });

      await prisma.alert.create({
        data: {
          type: 'approval',
          level: 'info',
          title: '临时授权已拒绝',
          content: `用户 ${tempAuth.userId} 对资源 ${tempAuth.resourceCode} 的临时授权已被拒绝`,
          targetType: 'temp_auth',
          targetId: id
        }
      });

      return res.json({
        success: true,
        message: '临时授权已拒绝'
      });
    }

    await prisma.approvalRecord.create({
      data: {
        nodeId: tempAuth.currentNodeId || '',
        approverId: req.user!.userId,
        targetType: 'temp_auth',
        targetId: id,
        action: 'approve',
        comment: data.comment
      }
    });

    const nodes = tempAuth.approvalFlow?.nodes || [];
    const currentNodeIndex = nodes.findIndex(n => n.id === tempAuth.currentNodeId);
    const isLastNode = currentNodeIndex === nodes.length - 1 || currentNodeIndex === -1;

    if (isLastNode) {
      const resource = await prisma.resource.findUnique({
        where: { code: tempAuth.resourceCode }
      });

      if (resource) {
        await prisma.dataPermission.create({
          data: {
            resourceId: resource.id,
            targetType: 'user',
            targetId: tempAuth.userId,
            permissionType: tempAuth.permissionType,
            expiresAt: tempAuth.endTime,
            createdBy: req.user!.userId
          }
        });
      }

      await prisma.tempAuthorization.update({
        where: { id },
        data: { status: 'approved', currentNodeId: null }
      });

      await prisma.alert.create({
        data: {
          type: 'approval',
          level: 'info',
          title: '临时授权已通过全部审批',
          content: `用户 ${tempAuth.userId} 对资源 ${tempAuth.resourceCode} 的临时授权已通过全部审批`,
          targetType: 'temp_auth',
          targetId: id
        }
      });

      return res.json({
        success: true,
        message: '临时授权已通过全部审批，权限将在开始时间生效'
      });
    }

    const nextNode = nodes[currentNodeIndex + 1];
    await prisma.tempAuthorization.update({
      where: { id },
      data: { currentNodeId: nextNode.id }
    });

    res.json({
      success: true,
      message: `已通过${nodes[currentNodeIndex]?.name || '当前'}节点审批，等待${nextNode.name}审批`,
      data: {
        currentNode: nextNode,
        completedNodes: currentNodeIndex + 1,
        totalNodes: nodes.length
      }
    });
  } catch (error) {
    console.error('Approve temp auth error:', error);
    res.status(400).json({
      success: false,
      message: '处理临时授权失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.get('/approval-flows', authMiddleware, async (req: Request, res: Response) => {
  try {
    const flows = await prisma.approvalFlow.findMany({
      where: { deletedAt: null },
      include: {
        nodes: { orderBy: { order: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: flows
    });
  } catch (error) {
    console.error('Get approval flows error:', error);
    res.status(500).json({
      success: false,
      message: '获取审批流程列表失败'
    });
  }
});

router.post('/approval-flows', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, type, description, nodes } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({
        success: false,
        message: '名称和类型为必填项'
      });
    }

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return res.status(400).json({
        success: false,
        message: '审批节点不能为空'
      });
    }

    const flow = await prisma.approvalFlow.create({
      data: {
        name,
        type,
        description,
        nodes: {
          create: nodes.map((node: { name: string; order: number; approverType: string; approverIds: string[] }, index: number) => ({
            name: node.name,
            order: index + 1,
            approverType: node.approverType || 'user',
            approverIds: JSON.stringify(node.approverIds || [])
          }))
        }
      },
      include: { nodes: true }
    });

    res.status(201).json({
      success: true,
      data: flow
    });
  } catch (error) {
    console.error('Create approval flow error:', error);
    res.status(400).json({
      success: false,
      message: '创建审批流程失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.put('/approval-flows/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, status, nodes } = req.body;

    if (nodes) {
      await prisma.approvalNode.deleteMany({ where: { flowId: id } });
      
      await prisma.approvalFlow.update({
        where: { id },
        data: {
          name,
          description,
          status,
          nodes: {
            create: nodes.map((node: { name: string; approverType: string; approverIds: string[] }, index: number) => ({
              name: node.name,
              order: index + 1,
              approverType: node.approverType || 'user',
              approverIds: JSON.stringify(node.approverIds || [])
            }))
          }
        },
        include: { nodes: true }
      });
    } else {
      await prisma.approvalFlow.update({
        where: { id },
        data: { name, description, status }
      });
    }

    res.json({
      success: true,
      message: '审批流程已更新'
    });
  } catch (error) {
    console.error('Update approval flow error:', error);
    res.status(400).json({
      success: false,
      message: '更新审批流程失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
});

router.delete('/approval-flows/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.$transaction([
      prisma.approvalNode.deleteMany({ where: { flowId: id } }),
      prisma.approvalFlow.update({
        where: { id },
        data: { deletedAt: new Date() }
      })
    ]);

    res.json({
      success: true,
      message: '审批流程已删除'
    });
  } catch (error) {
    console.error('Delete approval flow error:', error);
    res.status(500).json({
      success: false,
      message: '删除审批流程失败'
    });
  }
});

export default router;