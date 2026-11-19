import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateTicketInput, ListTicketsQuery } from './tickets.schema';
import type { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

/** 造一张假工单。真库里字段很多，用例只读这几个，多余的不影响断言 */
function fakeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    number: 1,
    subject: '打印机坏了',
    description: '按了没反应',
    priority: 'normal',
    ...overrides,
  };
}

/**
 * 造一个 Prisma 的唯一约束冲突。
 *
 * 形状必须和真实的一致：service 里的 isIdempotencyConflict 是把 meta 和
 * message 拼成字符串去找 `idempotency_key`。约束名里不带这个字串，
 * 就会被判成「别的唯一冲突」，用例也就失效了。
 */
function uniqueViolation(constraint: string) {
  return {
    code: 'P2002',
    meta: { constraint },
    message: `Unique constraint failed on the fields: (\`${constraint}\`)`,
  };
}

describe('TicketsService', () => {
  const ORG = '0748a20e-edee-47b8-8d8c-b315aa688be4';
  const USER = 'e889ccdc-5675-47ea-8246-0424ecbc77ed';
  const KEY = '11111111-2222-3333-4444-555555555555';
  const BODY: CreateTicketInput = {
    subject: '打印机坏了',
    description: '按了没反应',
  };

  let service: TicketsService;
  let repo: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByIdempotencyKey: ReturnType<typeof vi.fn>;
    findList: ReturnType<typeof vi.fn>;
  };

  // 每个用例前重建一次，避免上一个用例的调用记录和返回值污染下一个
  beforeEach(() => {
    repo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdempotencyKey: vi.fn(),
      findList: vi.fn(),
    };
    // 只依赖一个 repository，直接 new。Test.createTestingModule 是给
    // 依赖树很深的类准备的，这里用不着
    service = new TicketsService(repo as unknown as TicketsRepository);
  });

  describe('create', () => {
    it('成功建单时 replayed 为 false，身份和幂等键透传给仓储', async () => {
      repo.create.mockResolvedValue(fakeTicket());

      const result = await service.create(ORG, BODY, USER, KEY);

      expect(result.replayed).toBe(false);
      expect(result.ticket).toEqual(fakeTicket());
      expect(repo.create).toHaveBeenCalledWith(ORG, {
        ...BODY,
        requesterId: USER,
        idempotencyKey: KEY,
      });
      // 没冲突就不该走回查
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
    });

    it('唯一冲突时回查已有工单，replayed 为 true', async () => {
      repo.create.mockRejectedValue(uniqueViolation('tickets_org_id_idempotency_key_key'));
      repo.findByIdempotencyKey.mockResolvedValue(fakeTicket({ id: 'ticket-old', number: 7 }));

      const result = await service.create(ORG, BODY, USER, KEY);

      expect(result.replayed).toBe(true);
      expect(result.ticket).toMatchObject({ id: 'ticket-old', number: 7 });
      expect(repo.findByIdempotencyKey).toHaveBeenCalledWith(ORG, KEY);
    });

    it('唯一冲突但回查不到时，把原错误抛出去', async () => {
      const error = uniqueViolation('tickets_org_id_idempotency_key_key');
      repo.create.mockRejectedValue(error);
      repo.findByIdempotencyKey.mockResolvedValue(null);

      // toBe 比 toThrow 更严格：断言抛的就是同一个对象，没有被包装过
      await expect(service.create(ORG, BODY, USER, KEY)).rejects.toBe(error);
    });

    it('没带幂等键时不回查，冲突直接抛错', async () => {
      const error = uniqueViolation('tickets_org_id_idempotency_key_key');
      repo.create.mockRejectedValue(error);

      await expect(service.create(ORG, BODY, USER)).rejects.toBe(error);
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
    });

    it('别的唯一冲突不会被当成重发，避免吞掉真问题', async () => {
      const error = uniqueViolation('tickets_org_id_number_key');
      repo.create.mockRejectedValue(error);

      await expect(service.create(ORG, BODY, USER, KEY)).rejects.toBe(error);
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
    });

    it('非 P2002 的错误原样抛出', async () => {
      repo.create.mockRejectedValue(new Error('database is gone'));

      await expect(service.create(ORG, BODY, USER, KEY)).rejects.toThrow('database is gone');
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    it('找到时原样返回工单', async () => {
      repo.findById.mockResolvedValue(fakeTicket());

      await expect(service.detail(ORG, 'ticket-1')).resolves.toEqual(fakeTicket());
      expect(repo.findById).toHaveBeenCalledWith(ORG, 'ticket-1');
    });

    it('找不到时抛 404 且带 TICKET_NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.detail(ORG, 'nope')).rejects.toMatchObject({
        code: 'TICKET_NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('list', () => {
    it('把查询参数原样交给仓储，不做二次加工', async () => {
      const page = { data: [fakeTicket()], meta: { mode: 'offset', total: 1 } };
      repo.findList.mockResolvedValue(page);
      // query 在真实链路里由 zod 的 transform 归一化过，这里只关心透传
      const query = { pageSize: 10, pageNum: 1, mode: 'offset' } as unknown as ListTicketsQuery;

      const result = await service.list(ORG, query);

      expect(result).toEqual(page);
      expect(repo.findList).toHaveBeenCalledWith(ORG, query);
    });
  });
});
