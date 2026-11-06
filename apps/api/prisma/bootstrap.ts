/**
 * 生产初始化：在空库上跑一次，建出第一个组织和第一个管理员。
 *
 * 和 seed.ts 的区别很重要：
 *   seed.ts      开发/演示数据，进来先 truncate 再灌，跑一百次结果一样；
 *   bootstrap.ts 只补「从零到能登录」的最小数据，发现已有组织就退出，绝不覆盖。
 *
 * 用法（三个必填，密码不会出现在命令历史里就走环境变量）：
 *   BOOTSTRAP_ORG_NAME='云启科技' \
 *   BOOTSTRAP_ORG_SLUG='yunqi' \
 *   BOOTSTRAP_ADMIN_EMAIL='admin@yunqi.com' \
 *   BOOTSTRAP_ADMIN_PASSWORD='一串足够长的密码' \
 *   npx tsx prisma/bootstrap.ts
 */
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';

import { loadEnv } from '../src/config/load-env';
import { PrismaClient } from '../src/generated/prisma/client';

loadEnv();

// 初始化要写第一行数据，且没有租户上下文，只能用 owner 连接串。
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL || '',
  }),
});

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const email = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  const orgName = required('BOOTSTRAP_ORG_NAME');
  const orgSlug = required('BOOTSTRAP_ORG_SLUG').toLowerCase();

  // 密码策略在应用层校验一次，别指望数据库。12 位是底线，不是目标。
  if (password.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD 至少 12 位');
  }
  if (!/^[a-z0-9-]{2,32}$/.test(orgSlug)) {
    throw new Error('BOOTSTRAP_ORG_SLUG 只能用小写字母、数字、连字符，2~32 位');
  }

  // 幂等：已经有组织就认为初始化过了。
  // 生产只该跑一次，重复执行不应该造成任何改动 —— 这个判断比 try/catch 唯一键更直接。
  const existing = await prisma.organization.count();
  if (existing > 0) {
    process.stdout.write(`库里已有 ${existing} 个组织，跳过初始化。\n`);
    return;
  }

  // 参数与 seed 保持一致，登录一次大约 50~100ms，够快也不至于太好爆破
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  // 三张表要么一起成功，要么一起回滚。
  // 只剩组织没有管理员，或者管理员没进组织，都是"半初始化"状态，比空库更难排查。
  const { org, admin } = await prisma.$transaction(async (tx) => {
    const createdOrg = await tx.organization.create({
      data: { name: orgName, slug: orgSlug, plan: 'free' },
      select: { id: true, name: true, slug: true },
    });

    const createdAdmin = await tx.user.create({
      data: {
        email,
        passwordHash,
        name: '系统管理员',
        emailVerifiedAt: new Date(), // 自己建的管理员不需要再走验证邮件
      },
      select: { id: true, email: true },
    });

    await tx.membership.create({
      data: {
        orgId: createdOrg.id,
        userId: createdAdmin.id,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      },
    });

    return { org: createdOrg, admin: createdAdmin };
  });

  process.stdout.write(
    `初始化完成\n  组织    ${org.name} (${org.slug})\n  管理员  ${admin.email}\n`,
  );
  // 密码一个字都不打印。日志会被收集、会被转发、会留在别人屏幕上。
  process.stdout.write('密码未输出，请回你设置环境变量的地方取。\n');
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`初始化失败：${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
