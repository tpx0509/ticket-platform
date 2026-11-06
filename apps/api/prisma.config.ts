// Prisma 7 起不再自动读取 .env，配置入口就是这个文件。
// 显式加载仓库根目录的 .env，保证 CLI 与应用进程读到同一份配置。
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * CLI 用 owner 连接串，应用运行时用受限角色，这是两条不同的串。
 *
 * 迁移要 create/alter/drop，owner 才做得到；
 * 应用只该有 DML，否则 RLS 可以被自己关掉（见 enable_tenant_rls 迁移）。
 *
 * 没配 DATABASE_URL_MIGRATE 时退回 DATABASE_URL，保持单串的旧用法可用。
 */
const migrateUrl = process.env.DATABASE_URL_MIGRATE?.trim() || process.env.DATABASE_URL?.trim();
if (!migrateUrl) {
  throw new Error('缺少 DATABASE_URL_MIGRATE（迁移用的 owner 连接串）或 DATABASE_URL');
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: migrateUrl,
  },
});
