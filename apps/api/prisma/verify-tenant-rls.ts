/**
 * 验证 RLS 在应用侧真的生效。
 *
 * 这个脚本要说明的是 404 兜底的底层机制：
 * 拿 A 组织的上下文去查 B 组织的工单，连 SQL 都不用改，数据库就返回空。
 * 应用层看到 null，抛 404 —— 而不是先查出来、再判断 orgId、然后返回 403。
 *
 * 前提是应用连接串（DATABASE_URL）指向受限角色 ticket_app。
 * 如果它指向 owner 或 superuser，下面第一段就会提示「不受 RLS 约束」，结论全部作废 ——
 * 这正是 M3 第一版踩过的坑：策略写好了，但连接身份是 superuser，策略一次都没生效。
 *
 * 跑：npx tsx apps/api/prisma/verify-tenant-rls.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { loadEnv } from '../src/config/load-env';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';

loadEnv();

const APP_URL = process.env.DATABASE_URL ?? '';
const ADMIN_URL = process.env.DATABASE_URL_MIGRATE || APP_URL;

/** 应用身份：受 RLS 约束 */
const app = new PrismaClient({ adapter: new PrismaPg({ connectionString: APP_URL }) });
/** 运维身份：owner，用来做对照组 */
const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: ADMIN_URL }) });

const ORG_A = '0748a20e-edee-47b8-8d8c-b315aa688be4'; // 云启科技，101 张工单
const ORG_B = '7ec8441d-efef-4d80-bc83-6fdbd215a0e5'; // 恒星传媒，66 张
const TICKET_B = '6db7a27c-8177-4f24-807a-3289adc30b11'; // 属于恒星传媒

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

/** 与 PrismaService.withTenant 相同的实现，脚本里单独写一份，避免拖起整个 Nest 容器 */
async function withTenant<T>(
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  });
}

async function main(): Promise<void> {
  // 0. 先确认身份。superuser 会让后面所有结论失效
  const [role] = await app.$queryRaw<
    { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
  const guarded = role && !role.rolsuper && !role.rolbypassrls;
  line(
    `应用连接角色   ${role?.rolname ?? '?'}  ${guarded ? '（受 RLS 约束）' : '（不受 RLS 约束，下面结论无效）'}`,
  );
  line('');

  // 1. 不写任何 org_id 条件，看数据库给了多少行
  const countA = await withTenant(ORG_A, (tx) => tx.ticket.count());
  const countB = await withTenant(ORG_B, (tx) => tx.ticket.count());
  line(`云启上下文 count() = ${countA}（库里实际 101）`);
  line(`恒星上下文 count() = ${countB}（库里实际 66）`);
  line('');

  // 2. 越权读取：拿云启的上下文查恒星的工单
  const stolen = await withTenant(ORG_A, (tx) => tx.ticket.findUnique({ where: { id: TICKET_B } }));
  line(`云启上下文查恒星的工单 → ${stolen === null ? 'null（应用层据此抛 404）' : '拿到了，越权！'}`);

  // 3. 同样的查询，换成恒星自己的上下文
  const own = await withTenant(ORG_B, (tx) => tx.ticket.findUnique({ where: { id: TICKET_B } }));
  line(`恒星上下文查同一张工单 → ${own === null ? 'null（不对）' : `拿到 #${own.number}`}`);
  line('');

  // 4. 绕过 withTenant 直接查：没有租户上下文，策略无法评估，应该直接报错
  //
  // 报错文案取决于这条连接之前有没有跑过 withTenant：
  //   全新连接（参数从未出现）→ unrecognized configuration parameter "app.org_id"
  //   用过的连接（set local 回滚后参数变空串）→ invalid input syntax for type uuid: ""
  // 两种都是错，方向都是"炸掉"而不是"返回 0 行"，这正是我们要的。
  try {
    const leaked = await app.ticket.findMany({ take: 1 });
    line(`绕过 withTenant 直接查 → 拿到 ${leaked.length} 行，越权！`);
  } catch (err) {
    // Prisma 把数据库原始报错包在一段多行文案里，真正那一句在最后
    const lines = (err instanceof Error ? err.message : String(err))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const message = lines[lines.length - 1] ?? String(err);
    line(`绕过 withTenant 直接查 → 报错：${message}`);
  }
  line('');

  // 5. 对照组：owner 连接不受策略约束，看到全部 200 行
  const asAdmin = await admin.ticket.count();
  line(`owner 连接（DATABASE_URL_MIGRATE）count() = ${asAdmin}，不受策略约束`);
  line('   ↑ 所以 owner 连接串只能用于迁移和运维，不能出现在运行时配置里');
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`验证失败：${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([app.$disconnect(), admin.$disconnect()]);
  });
