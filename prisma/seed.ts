import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth';

const prisma = new PrismaClient();

async function main() {
  console.log('开始初始化数据...');

  const adminDept = await prisma.department.create({
    data: {
      name: '总部',
      code: 'HQ'
    }
  });

  const techDept = await prisma.department.create({
    data: {
      name: '技术部',
      code: 'TECH',
      parentId: adminDept.id
    }
  });

  const financeDept = await prisma.department.create({
    data: {
      name: '财务部',
      code: 'FIN',
      parentId: adminDept.id
    }
  });

  const salesDept = await prisma.department.create({
    data: {
      name: '销售部',
      code: 'SALES',
      parentId: adminDept.id
    }
  });

  console.log('部门创建完成');

  const adminRole = await prisma.role.create({
    data: {
      name: '系统管理员',
      code: 'admin',
      type: 'system',
      description: '拥有系统全部权限'
    }
  });

  const managerRole = await prisma.role.create({
    data: {
      name: '部门经理',
      code: 'manager',
      type: 'system',
      description: '拥有部门管理权限'
    }
  });

  const analystRole = await prisma.role.create({
    data: {
      name: '数据分析员',
      code: 'analyst',
      type: 'custom',
      description: '可查看分析报表'
    }
  });

  const viewerRole = await prisma.role.create({
    data: {
      name: '普通用户',
      code: 'viewer',
      type: 'custom',
      description: '基础查看权限'
    }
  });

  console.log('角色创建完成');

  const readPerm = await prisma.permission.create({
    data: {
      name: '读取权限',
      code: 'perm:read',
      type: 'operation',
      description: '基础读取操作权限'
    }
  });

  const writePerm = await prisma.permission.create({
    data: {
      name: '写入权限',
      code: 'perm:write',
      type: 'operation',
      description: '数据写入操作权限'
    }
  });

  const adminPerm = await prisma.permission.create({
    data: {
      name: '管理权限',
      code: 'perm:admin',
      type: 'operation',
      description: '系统管理权限'
    }
  });

  const reportPerm = await prisma.permission.create({
    data: {
      name: '报表查看',
      code: 'resource:report:view',
      type: 'resource',
      description: '查看报表资源'
    }
  });

  const apiPerm = await prisma.permission.create({
    data: {
      name: 'API调用',
      code: 'resource:api:call',
      type: 'resource',
      description: '调用API资源'
    }
  });

  console.log('权限创建完成');

  await prisma.rolePermission.createMany({
    data: [
      { roleId: adminRole.id, permissionId: readPerm.id },
      { roleId: adminRole.id, permissionId: writePerm.id },
      { roleId: adminRole.id, permissionId: adminPerm.id },
      { roleId: adminRole.id, permissionId: reportPerm.id },
      { roleId: adminRole.id, permissionId: apiPerm.id },
      { roleId: managerRole.id, permissionId: readPerm.id },
      { roleId: managerRole.id, permissionId: writePerm.id },
      { roleId: managerRole.id, permissionId: reportPerm.id },
      { roleId: analystRole.id, permissionId: readPerm.id },
      { roleId: analystRole.id, permissionId: reportPerm.id },
      { roleId: viewerRole.id, permissionId: readPerm.id }
    ]
  });

  console.log('角色权限关联完成');

  const adminUser = await prisma.user.create({
    data: {
      username: 'admin',
      password: hashPassword('admin123'),
      realName: '系统管理员',
      email: 'admin@example.com',
      departmentId: adminDept.id,
      status: 1
    }
  });

  const techManager = await prisma.user.create({
    data: {
      username: 'tech_manager',
      password: hashPassword('manager123'),
      realName: '技术经理',
      email: 'tech_manager@example.com',
      departmentId: techDept.id,
      status: 1
    }
  });

  const analystUser = await prisma.user.create({
    data: {
      username: 'analyst',
      password: hashPassword('analyst123'),
      realName: '数据分析师',
      email: 'analyst@example.com',
      departmentId: techDept.id,
      status: 1
    }
  });

  const financeUser = await prisma.user.create({
    data: {
      username: 'finance_user',
      password: hashPassword('finance123'),
      realName: '财务专员',
      email: 'finance@example.com',
      departmentId: financeDept.id,
      status: 1
    }
  });

  const salesUser = await prisma.user.create({
    data: {
      username: 'sales_user',
      password: hashPassword('sales123'),
      realName: '销售专员',
      email: 'sales@example.com',
      departmentId: salesDept.id,
      status: 1
    }
  });

  console.log('用户创建完成');

  await prisma.userRole.createMany({
    data: [
      { userId: adminUser.id, roleId: adminRole.id },
      { userId: techManager.id, roleId: managerRole.id },
      { userId: analystUser.id, roleId: analystRole.id },
      { userId: financeUser.id, roleId: viewerRole.id },
      { userId: salesUser.id, roleId: viewerRole.id }
    ]
  });

  console.log('用户角色关联完成');

  const reportCategory = await prisma.resourceCategory.create({
    data: {
      name: '报表',
      code: 'report'
    }
  });

  const apiCategory = await prisma.resourceCategory.create({
    data: {
      name: 'API接口',
      code: 'api'
    }
  });

  const analysisCategory = await prisma.resourceCategory.create({
    data: {
      name: '分析工具',
      code: 'analysis'
    }
  });

  console.log('资源分类创建完成');

  const salesReport = await prisma.resource.create({
    data: {
      name: '销售数据报表',
      code: 'report:sales',
      type: 'report',
      categoryId: reportCategory.id,
      description: '展示销售部门业绩数据'
    }
  });

  const financeReport = await prisma.resource.create({
    data: {
      name: '财务报表',
      code: 'report:finance',
      type: 'report',
      categoryId: reportCategory.id,
      description: '展示财务收支数据'
    }
  });

  const userAnalysis = await prisma.resource.create({
    data: {
      name: '用户行为分析',
      code: 'analysis:user_behavior',
      type: 'analysis',
      categoryId: analysisCategory.id,
      description: '分析用户行为数据'
    }
  });

  const salesApi = await prisma.resource.create({
    data: {
      name: '销售数据API',
      code: 'api:sales_data',
      type: 'api',
      categoryId: apiCategory.id,
      description: '提供销售数据查询接口'
    }
  });

  const financeApi = await prisma.resource.create({
    data: {
      name: '财务数据API',
      code: 'api:finance_data',
      type: 'api',
      categoryId: apiCategory.id,
      description: '提供财务数据查询接口'
    }
  });

  console.log('资源创建完成');

  await prisma.dataPermission.createMany({
    data: [
      {
        resourceId: salesReport.id,
        targetType: 'department',
        targetId: salesDept.id,
        permissionType: 'read',
        rowFilter: JSON.stringify({ department: 'SALES' }),
        priority: 10
      },
      {
        resourceId: salesReport.id,
        targetType: 'role',
        targetId: managerRole.id,
        permissionType: 'read',
        priority: 20
      },
      {
        resourceId: financeReport.id,
        targetType: 'department',
        targetId: financeDept.id,
        permissionType: 'read',
        rowFilter: JSON.stringify({ department: 'FIN' }),
        priority: 10
      },
      {
        resourceId: financeReport.id,
        targetType: 'role',
        targetId: adminRole.id,
        permissionType: 'admin',
        priority: 100
      },
      {
        resourceId: userAnalysis.id,
        targetType: 'role',
        targetId: analystRole.id,
        permissionType: 'read',
        priority: 10
      },
      {
        resourceId: salesApi.id,
        targetType: 'department',
        targetId: salesDept.id,
        permissionType: 'read',
        priority: 10
      },
      {
        resourceId: financeApi.id,
        targetType: 'department',
        targetId: financeDept.id,
        permissionType: 'read',
        priority: 10
      }
    ]
  });

  console.log('数据权限创建完成');

  const approvalFlow = await prisma.approvalFlow.create({
    data: {
      name: '授权审批流程',
      type: 'authorization',
      description: '数据访问授权审批流程',
      nodes: {
        create: [
          {
            name: '部门经理审批',
            order: 1,
            approverType: 'role',
            approverIds: JSON.stringify([managerRole.id])
          },
          {
            name: '管理员审批',
            order: 2,
            approverType: 'user',
            approverIds: JSON.stringify([adminUser.id])
          }
        ]
      }
    }
  });

  console.log('审批流程创建完成');

  await prisma.departmentPermission.createMany({
    data: [
      {
        departmentId: techDept.id,
        permissionId: readPerm.id,
        inherit: true
      },
      {
        departmentId: financeDept.id,
        permissionId: readPerm.id,
        inherit: true
      },
      {
        departmentId: salesDept.id,
        permissionId: readPerm.id,
        inherit: true
      }
    ]
  });

  console.log('部门权限创建完成');

  console.log('数据初始化完成！');
  console.log('\n默认账号信息：');
  console.log('管理员: admin / admin123');
  console.log('技术经理: tech_manager / manager123');
  console.log('分析师: analyst / analyst123');
  console.log('财务专员: finance_user / finance123');
  console.log('销售专员: sales_user / sales123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });