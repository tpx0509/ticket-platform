import { Injectable } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';

/**
 * 详情页要的字段。列表接口的字段是另一套（要 commentCount，不要 description），
 * 所以 select 分开写，不共用一个"大而全"的常量 —— 那会让每个接口都多查几列。
 */
const detailSelect = {
  id: true,
  number: true,
  subject: true,
  description: true,
  status: true,
  priority: true,
  category: true,
  source: true,
  firstResponseAt: true,
  slaDueAt: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect;

export type TicketDetailRow = Prisma.TicketGetPayload<{ select: typeof detailSelect }>;

@Injectable()
export class TicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按 (orgId, id) 取一张未删除的工单。
   *
   * 两个条件缺一不可，但作用不同：
   *   orgId   —— 应用层的第一道防线。数据库 RLS 会再加一遍，但代码里也必须写，
   *              因为 RLS 是"最后兜底"，不是"唯一保障"。策略被误删、迁移漏跑、
   *              连接串配错，任何一件发生都还有这一层。
   *   deletedAt —— 软删。RLS 只管租户，不管业务上的"这条已经删了"。
   *
   * 查不到就是 null，不区分"不存在"和"不属于你"。区分开等于对外提供
   * 一个探测 id 是否存在的接口。
   */
  findById(orgId: string, id: string): Promise<TicketDetailRow | null> {
    return this.prisma.withTenant(orgId, (tx) =>
      tx.ticket.findFirst({
        where: { id, orgId, deletedAt: null },
        select: detailSelect,
      }),
    );
  }
}
