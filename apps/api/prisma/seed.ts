/**
 * 开发与演示数据。不是"假数据"，是用来验证约束、索引和分页的真实体量数据：
 * 200 张工单才看得出索引差别，几十行看不出来。
 *
 * 可重复执行：每次先清空再灌，结果一致（随机数用固定种子）。
 */
import { randomUUID } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';

import { loadEnv } from '../src/config/load-env';
import { PrismaClient } from '../src/generated/prisma/client';

loadEnv();

// 灌数据要跨组织写，还得 truncate，只能用 owner 连接串。
// 应用角色 ticket_app 没有 DDL 权限，跑这个脚本会直接 permission denied。
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL || '',
  }),
});

/** 固定种子的线性同余发生器：每次跑出来的数据完全一样，方便对着截图排查。 */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const rand = createRandom(20_261_103);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);

function randomUnitVector(dim: number): string {
  const values: number[] = [];
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    // Box-Muller，得到近似正态分布的分量
    const u = Math.max(rand(), Number.EPSILON);
    const v = rand();
    const value = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    values.push(value);
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  return `[${values.map((value) => (value / norm).toFixed(6)).join(',')}]`;
}

const ORGS = [
  { name: '云启科技', slug: 'yunqi', plan: 'pro' },
  { name: '恒星传媒', slug: 'hengxing', plan: 'pro' },
  { name: '栖木设计', slug: 'qimu', plan: 'free' },
] as const;

const USER_NAMES = [
  '陈默', '林知远', '苏晚', '周砚', '许清和', '罗一鸣',
  '沈星河', '唐棠', '顾南舟', '叶青', '孟秋', '韩野',
] as const;

const TICKET_SUBJECTS = [
  '登录后跳转到空白页', '导出 CSV 中文乱码', '发票抬头需要修改', '批量导入提示格式错误',
  '移动端上传附件失败', '账单金额与实际不符', 'API 返回 429 限流', '账号无法接收验证码',
  '报表数据延迟一天', '需要开通子账号', '密码重置链接过期', '数据看板加载超时',
  '订单状态未同步', '附件下载速度很慢', '权限调整后未生效', '系统提示未知错误',
] as const;

const TICKET_DESCRIPTIONS = [
  '复现步骤：1. 使用 Chrome 打开工作台 2. 点击右上角导出 3. 文件打开后中文全部显示为乱码。\n期望：导出的 CSV 使用 UTF-8 BOM 编码。',
  '从昨天下午开始出现，大约每十次操作出现两三次。\n浏览器控制台没有报错，网络面板显示接口返回 500。',
  '客户反馈在移动端（iOS Safari）选择文件后点击上传没有反应，安卓正常。',
  '同一批数据导入三次，每次报错的行号都不同，怀疑是并发写入导致的。',
  '这个月账单比上个月多了约 12%，但没有新增成员，需要核对调用明细。',
] as const;

const STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const CATEGORIES = ['账号与登录', '计费与账单', '数据导出', '接口调用', '客户端异常'] as const;
const SOURCES = ['web', 'email', 'api'] as const;

const COMMENT_BODIES = [
  '已收到，正在排查，预计今天内给你结论。',
  '麻烦提供一下出现问题的账号和大致时间点。',
  '已在测试环境复现，是导出时没有写 BOM 头，修复中。',
  '这个问题和上周那个属于同一个原因，已合并处理。',
  '已发布修复版本，请刷新后重试。',
  '内部备注：需要产品确认这个行为是否符合预期。',
] as const;

async function main(): Promise<void> {
  process.stdout.write('清空既有数据…\n');
  await prisma.$executeRawUnsafe(
    `truncate table ai_runs, kb_chunks, kb_articles, attachments, ticket_events,
       ticket_comments, tickets, refresh_tokens, memberships, users, organizations
     restart identity cascade`,
  );

  // 所有种子账号同一个开发期密码，登录测试时不用记 12 个
  const passwordHash = await hash('DevPassw0rd!', { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  process.stdout.write('写入组织与用户…\n');

  const orgs = ORGS.map((org) => ({ id: randomUUID(), ...org, createdAt: daysAgo(90), updatedAt: daysAgo(3) }));
  await prisma.organization.createMany({ data: orgs });

  const users = USER_NAMES.map((name, index) => ({
    id: randomUUID(),
    email: `user${String(index + 1).padStart(2, '0')}@example.com`,
    passwordHash,
    name,
    emailVerifiedAt: daysAgo(60 - index),
    lastLoginAt: daysAgo(int(0, 10)),
    createdAt: daysAgo(80 - index),
    updatedAt: daysAgo(int(0, 5)),
  }));
  await prisma.user.createMany({ data: users });

  const [orgA, orgB, orgC] = orgs as [(typeof orgs)[number], (typeof orgs)[number], (typeof orgs)[number]];
  const [u1, u2, , , , , u7, , , u10] = users as (typeof users)[number][];

  const membershipRows = [
    { orgId: orgA.id, userId: u1.id, role: 'owner', status: 'active' },
    { orgId: orgA.id, userId: u2.id, role: 'admin', status: 'active' },
    ...[3, 4, 5, 6].map((n) => ({ orgId: orgA.id, userId: users[n - 1]!.id, role: 'agent', status: 'active' })),
    { orgId: orgB.id, userId: u1.id, role: 'viewer', status: 'active' },
    { orgId: orgB.id, userId: u7.id, role: 'owner', status: 'active' },
    { orgId: orgB.id, userId: users[7]!.id, role: 'agent', status: 'active' },
    { orgId: orgB.id, userId: users[8]!.id, role: 'agent', status: 'invited' },
    { orgId: orgC.id, userId: u10.id, role: 'owner', status: 'active' },
    { orgId: orgC.id, userId: users[10]!.id, role: 'agent', status: 'active' },
    { orgId: orgC.id, userId: users[11]!.id, role: 'viewer', status: 'suspended' },
  ].map((row) => ({
    id: randomUUID(),
    ...row,
    invitedById: row.userId === u1.id ? null : u1.id,
    joinedAt: row.status === 'active' ? daysAgo(int(10, 60)) : null,
    createdAt: daysAgo(70),
    updatedAt: daysAgo(10),
  }));
  await prisma.membership.createMany({ data: membershipRows });

  process.stdout.write('写入工单、评论与事件…\n');
  const tickets: {
    id: string;
    orgId: string;
    number: number;
    subject: string;
    description: string;
    status: string;
    priority: string;
    category: string | null;
    requesterId: string;
    assigneeId: string | null;
    source: string;
    aiCategory: string | null;
    aiConfidence: number | null;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt: Date | null;
    closedAt: Date | null;
    firstResponseAt: Date | null;
  }[] = [];

  const membersByOrg = new Map<string, string[]>();
  for (const row of membershipRows) {
    const list = membersByOrg.get(row.orgId) ?? [];
    list.push(row.userId);
    membersByOrg.set(row.orgId, list);
  }

  const orgRotation = [orgA, orgA, orgA, orgB, orgB, orgC]; // 200 张按 3:2:1 分配，第一个组织数据最多
  const counters = new Map<string, number>();

  for (let i = 0; i < 200; i += 1) {
    const org = orgRotation[i % orgRotation.length]!;
    const number = (counters.get(org.id) ?? 0) + 1;
    counters.set(org.id, number);

    const members = membersByOrg.get(org.id)!;
    const createdAt = daysAgo(int(0, 120));
    const status = pick(STATUSES);
    const resolvedAt = status === 'resolved' || status === 'closed' ? new Date(createdAt.getTime() + int(1, 72) * 3_600_000) : null;

    tickets.push({
      id: randomUUID(),
      orgId: org.id,
      number,
      subject: pick(TICKET_SUBJECTS),
      description: pick(TICKET_DESCRIPTIONS),
      status,
      priority: pick(PRIORITIES),
      category: rand() > 0.25 ? pick(CATEGORIES) : null,
      requesterId: pick(members),
      assigneeId: rand() > 0.3 ? pick(members) : null,
      source: pick(SOURCES),
      aiCategory: rand() > 0.35 ? pick(CATEGORIES) : null,
      aiConfidence: Number((0.55 + rand() * 0.44).toFixed(3)),
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
      resolvedAt,
      closedAt: status === 'closed' ? resolvedAt : null,
      firstResponseAt: rand() > 0.2 ? new Date(createdAt.getTime() + int(5, 300) * 60_000) : null,
    });
  }
  await prisma.ticket.createMany({ data: tickets });

  const comments: {
    id: string;
    orgId: string;
    ticketId: string;
    authorId: string;
    body: string;
    isInternal: boolean;
    createdAt: Date;
    updatedAt: Date;
  }[] = [];
  for (let i = 0; i < 500; i += 1) {
    const ticket = tickets[i % tickets.length]!;
    const members = membersByOrg.get(ticket.orgId)!;
    const createdAt = new Date(ticket.createdAt.getTime() + int(1, 60) * 3_600_000);
    comments.push({
      id: randomUUID(),
      orgId: ticket.orgId,
      ticketId: ticket.id,
      authorId: pick(members),
      body: pick(COMMENT_BODIES),
      isInternal: rand() > 0.7,
      createdAt,
      updatedAt: createdAt,
    });
  }
  await prisma.ticketComment.createMany({ data: comments });

  const events: {
    id: string;
    orgId: string;
    ticketId: string;
    actorId: string | null;
    type: string;
    fromValue: string | null;
    toValue: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }[] = [];

  for (const ticket of tickets) {
    events.push({
      id: randomUUID(),
      orgId: ticket.orgId,
      ticketId: ticket.id,
      actorId: ticket.requesterId,
      type: 'created',
      fromValue: null,
      toValue: null,
      metadata: { source: ticket.source },
      createdAt: ticket.createdAt,
    });
    if (ticket.status !== 'open') {
      events.push({
        id: randomUUID(),
        orgId: ticket.orgId,
        ticketId: ticket.id,
        actorId: ticket.assigneeId,
        type: 'status_changed',
        fromValue: 'open',
        toValue: ticket.status,
        metadata: {},
        createdAt: new Date(ticket.createdAt.getTime() + int(1, 48) * 3_600_000),
      });
    }
  }
  await prisma.ticketEvent.createMany({ data: events });

  const attachments = Array.from({ length: 60 }, () => {
    const ticket = pick(tickets);
    const id = randomUUID();
    return {
      id,
      orgId: ticket.orgId,
      ticketId: ticket.id,
      uploaderId: ticket.requesterId,
      fileName: `截图-${id.slice(0, 6)}.png`,
      mimeType: 'image/png',
      size: BigInt(int(80_000, 4_000_000)),
      storageKey: `org/${ticket.orgId}/${id}`,
      checksum: id.replace(/-/g, '').padEnd(64, '0'),
      createdAt: ticket.createdAt,
    };
  });
  await prisma.attachment.createMany({ data: attachments });

  process.stdout.write('写入知识库与向量…\n');
  const articles: {
    id: string;
    orgId: string;
    title: string;
    content: string;
    status: string;
    authorId: string;
    indexedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }[] = [];
  for (let i = 0; i < 50; i += 1) {
    const org = i < 30 ? orgA : i < 42 ? orgB : orgC;
    const members = membersByOrg.get(org.id)!;
    const published = rand() > 0.2;
    articles.push({
      id: randomUUID(),
      orgId: org.id,
      title: `${pick(CATEGORIES)}处理手册 ${i + 1}`,
      content: `${pick(TICKET_DESCRIPTIONS)}\n\n处理步骤：\n1. 确认账号与时间点\n2. 检查接口返回码\n3. 在测试环境复现\n\n常见原因：编码不一致、并发写入、缓存未失效。`,
      status: published ? 'published' : 'draft',
      authorId: pick(members),
      indexedAt: published ? daysAgo(int(0, 20)) : null,
      createdAt: daysAgo(int(20, 200)),
      updatedAt: daysAgo(int(0, 20)),
    });
  }
  await prisma.kbArticle.createMany({ data: articles });

  const chunkRows: { id: string; orgId: string; articleId: string; seq: number; content: string; tokenCount: number; createdAt: Date }[] = [];
  for (const article of articles) {
    const total = int(3, 5);
    for (let seq = 0; seq < total; seq += 1) {
      chunkRows.push({
        id: randomUUID(),
        orgId: article.orgId,
        articleId: article.id,
        seq,
        content: `第 ${seq + 1} 段：${pick(COMMENT_BODIES)} 相关说明见工单处理记录。`,
        tokenCount: int(120, 480),
        createdAt: article.createdAt,
      });
    }
  }
  await prisma.kbChunk.createMany({ data: chunkRows });

  // embedding 是 Unsupported 类型，Prisma 客户端看不到，只能走原生 SQL
  for (const chunk of chunkRows) {
    await prisma.$executeRawUnsafe(
      'update kb_chunks set embedding = $1::vector where id = $2::uuid',
      randomUnitVector(1024),
      chunk.id,
    );
  }

  process.stdout.write('写入模型调用记录…\n');
  const aiRuns = Array.from({ length: 300 }, () => {
    const org = pick(orgs);
    const kind = pick(['classify', 'suggest', 'embed', 'ask'] as const);
    const status = rand() > 0.08 ? 'success' : pick(['failed', 'timeout'] as const);
    return {
      id: randomUUID(),
      orgId: org.id,
      kind,
      model: kind === 'embed' ? 'text-embedding-v3' : 'deepseek-chat',
      status,
      promptTokens: int(200, 4_000),
      completionTokens: status === 'success' ? int(50, 800) : 0,
      costMicros: int(1_000, 90_000),
      latencyMs: int(300, 8_000),
      error: status === 'success' ? null : 'upstream timeout after 60s',
      refType: rand() > 0.5 ? 'ticket' : 'kb_article',
      refId: pick(tickets).id,
      createdAt: daysAgo(int(0, 30)),
    };
  });
  await prisma.aiRun.createMany({ data: aiRuns });

  const summary = {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    memberships: await prisma.membership.count(),
    tickets: await prisma.ticket.count(),
    ticket_comments: await prisma.ticketComment.count(),
    ticket_events: await prisma.ticketEvent.count(),
    attachments: await prisma.attachment.count(),
    kb_articles: await prisma.kbArticle.count(),
    kb_chunks: await prisma.kbChunk.count(),
    ai_runs: await prisma.aiRun.count(),
  };
  process.stdout.write(`完成：${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`种子数据写入失败：${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
