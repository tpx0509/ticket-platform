import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { PrismaClient } from 'src/generated/prisma/client';
import { RedisService } from 'src/infra/redis/redis.service';

/**
 * 接口测试跑的是真实的 Nest 应用、真实的 Postgres（ticket_test）和真实的 Redis。
 *
 * 和单测的分工：单测证明「逻辑对」，这里证明「接起来通」——
 * 路由前缀、Guard 顺序、全局过滤器、响应信封这些只有跑通整条链路才看得见。
 *
 * 环境在 src/test/setup.ts 里切好了，这里只负责用。
 */
const PASSWORD = 'DevPassw0rd!';

describe('Tickets 接口', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  /** owner 角色连测试库，绕开 RLS 做数据核对 */
  let admin: PrismaClient;

  let yunqiId: string;
  let hengxingId: string;
  let ownerToken: string; // user01：云启 owner
  let viewerToken: string; // user01：同一个账号，在恒星只是 viewer
  let agentToken: string; // user03：云启 agent
  let outsiderToken: string; // user07：恒星 owner，在云启没有任何关系

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    // 和 main.ts 走同一个装配函数，否则测试里的路由没有 /api/v1 前缀
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());

    // 15 号库是测试专用，进来先清干净：上一轮跑剩下的限流计数会让这一轮直接 429
    await app.get(RedisService).client.flushdb();

    // 组织 id 是 seed 时随机生成的，不能硬编码，只能查
    admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_MIGRATE ?? '' }),
    });
    const orgs = await admin.organization.findMany({
      where: { slug: { in: ['yunqi', 'hengxing'] } },
      select: { id: true, slug: true },
    });
    yunqiId = orgs.find((org) => org.slug === 'yunqi')!.id;
    hengxingId = orgs.find((org) => org.slug === 'hengxing')!.id;

    ownerToken = await login('user01@example.com');
    viewerToken = ownerToken; // 同一个 token，换组织时角色就变了
    agentToken = await login('user03@example.com');
    outsiderToken = await login('user07@example.com');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await admin?.$disconnect();
  });

  async function login(email: string): Promise<string> {
    const res = await http.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  it('没带 token 访问工单列表返回 401', async () => {
    const res = await http.get(`/api/v1/orgs/${yunqiId}/tickets`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('COMMON_UNAUTHORIZED');
    // 错误响应也必须带 requestId，否则用户报障时无从定位
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('owner 建单返回 201，响应被信封包住', async () => {
    const res = await http
      .post(`/api/v1/orgs/${yunqiId}/tickets`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ subject: '接口测试-建单', description: 'supertest 发的' });

    expect(res.status).toBe(201);
    // controller 只返回工单本身，重放的事实放在 Idempotent-Replay 头里
    expect(res.body.data).toMatchObject({ subject: '接口测试-建单' });
    expect(res.headers['idempotent-replay']).toBeUndefined();
    expect(res.body.meta.requestId).toBeTruthy();
  });

  it('同一个幂等键提交三次，库里只有一条', async () => {
    const key = randomUUID();
    const ids: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const res = await http
        .post(`/api/v1/orgs/${yunqiId}/tickets`)
        .set('Authorization', `Bearer ${agentToken}`)
        .set('Idempotency-Key', key)
        .send({ subject: '接口测试-幂等', description: '三次同一个 key' });

      expect(res.status).toBe(201);
      ids.push(res.body.data.id as string);
      // 第 2、3 次是重放，靠这个头区分，状态码仍是 201
      if (i > 0) expect(res.headers['idempotent-replay']).toBe('true');
    }

    expect(new Set(ids).size).toBe(1);
    expect(await admin.ticket.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('viewer 建单被 RBAC 挡住，返回 403', async () => {
    const res = await http
      .post(`/api/v1/orgs/${hengxingId}/tickets`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ subject: '接口测试-viewer', description: '不该成功' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMMON_FORBIDDEN');
  });

  it('跨组织访问返回 404 而不是 403，不泄露资源是否存在', async () => {
    const res = await http
      .get(`/api/v1/orgs/${yunqiId}/tickets`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(res.status).toBe(404);
  });

  it('cursor 分页翻两页不重复，排序连续', async () => {
    const first = await http
      .get(`/api/v1/orgs/${yunqiId}/tickets`)
      .query({ pageSize: 5, sort: 'number', order: 'asc' })
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(first.status).toBe(200);
    const firstNumbers = (first.body.data.data as { number: number }[]).map((row) => row.number);
    expect(firstNumbers).toHaveLength(5);

    const second = await http
      .get(`/api/v1/orgs/${yunqiId}/tickets`)
      .query({ pageSize: 5, sort: 'number', order: 'asc', cursor: first.body.data.meta.nextCursor })
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(second.status).toBe(200);
    const secondNumbers = (second.body.data.data as { number: number }[]).map((row) => row.number);

    // 第一页最后一条 < 第二页第一条，说明游标接上了，没重没漏
    expect(secondNumbers[0]).toBeGreaterThan(firstNumbers[firstNumbers.length - 1]!);
    expect(secondNumbers.some((n) => firstNumbers.includes(n))).toBe(false);
    // 翻页时后端记得住排序，不会悄悄换回默认值
    expect(second.body.data.meta.mode).toBe('cursor');
  });
});
