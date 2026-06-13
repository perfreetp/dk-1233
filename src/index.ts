import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import prisma from './lib/prisma';

import authRoutes from './routes/auth';
import roleRoutes from './routes/roles';
import resourceRoutes from './routes/resources';
import dataPermissionRoutes from './routes/dataPermissions';
import authorizationRoutes from './routes/authorization';
import permissionCheckRoutes from './routes/permissionCheck';
import adminRoutes from './routes/admin';
import alertRoutes from './routes/alerts';
import { auditMiddleware } from './middleware/audit';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: '数据权限服务运行正常',
    timestamp: new Date().toISOString()
  });
});

app.use(auditMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/data-permissions', dataPermissionRoutes);
app.use('/api/authorization', authorizationRoutes);
app.use('/api/permission', permissionCheckRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/alerts', alertRoutes);

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

async function checkExpiredPermissions() {
  try {
    const now = new Date();
    const warningDays = 3;
    const warningDate = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);

    const expiringPerms = await prisma.dataPermission.findMany({
      where: {
        deletedAt: null,
        expiresAt: { gte: now, lte: warningDate }
      },
      include: {
        resource: { select: { name: true, code: true } }
      }
    });

    for (const perm of expiringPerms) {
      const days = Math.ceil((new Date(perm.expiresAt!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      
      await prisma.alert.create({
        data: {
          type: 'permission_expiry',
          level: days <= 1 ? 'high' : 'warning',
          title: '权限即将过期',
          content: `资源 ${perm.resource.name} 的数据权限将在 ${days} 天后过期`,
          targetType: 'data_permission',
          targetId: perm.id
        }
      });
    }

    const highRiskPerms = await prisma.dataPermission.findMany({
      where: {
        deletedAt: null,
        permissionType: 'admin',
        targetType: 'user'
      },
      include: {
        resource: { select: { name: true, code: true } }
      }
    });

    for (const perm of highRiskPerms) {
      const existingAlert = await prisma.alert.findFirst({
        where: {
          type: 'high_risk_permission',
          targetId: perm.id,
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
        }
      });

      if (!existingAlert) {
        await prisma.alert.create({
          data: {
            type: 'high_risk_permission',
            level: 'high',
            title: '高风险权限提醒',
            content: `用户拥有资源 ${perm.resource.name} 的管理员权限，请确认是否必要`,
            targetType: 'data_permission',
            targetId: perm.id
          }
        });
      }
    }

    console.log('Permission check completed');
  } catch (error) {
    console.error('Check expired permissions error:', error);
  }
}

async function startServer() {
  try {
    await prisma.$connect();
    console.log('数据库连接成功');

    const server = app.listen(PORT, () => {
      console.log(`数据权限服务已启动: http://localhost:${PORT}`);
      console.log(`API文档: http://localhost:${PORT}/api/health`);
    });

    setInterval(checkExpiredPermissions, 60 * 60 * 1000);
    checkExpiredPermissions();

    process.on('SIGINT', async () => {
      console.log('正在关闭服务...');
      await prisma.$disconnect();
      server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('正在关闭服务...');
      await prisma.$disconnect();
      server.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('启动服务失败:', error);
    process.exit(1);
  }
}

startServer();