import { Injectable } from '@nestjs/common';

import { AppError } from '../common/error-codes';
import type { TicketDetailResponse } from './dto/ticket-detail.dto';
import { type TicketDetailRow, TicketsRepository } from './tickets.repository';

@Injectable()
export class TicketsService {
  constructor(private readonly tickets: TicketsRepository) {}

  /**
   * 取工单详情。
   *
   * 没有权限判断，也没有 403 —— 这是有意的。
   * 别人的工单在查询里就不存在，结果和"这个 id 从来没存在过"完全一样。
   *
   * 等到加鉴权时，orgId 要从 token 里取并校验 membership，
   * 但查询条件仍然只能是 `where: { orgId, id }`，不能变成"先查再比 orgId"。
   */
  async getById(orgId: string, id: string): Promise<TicketDetailResponse> {
    const ticket = await this.tickets.findById(orgId, id);
    if (!ticket) {
      throw new AppError('TICKET_NOT_FOUND');
    }
    return TicketsService.toResponse(ticket);
  }

  private static toResponse(ticket: TicketDetailRow): TicketDetailResponse {
    return {
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      source: ticket.source,
      requester: ticket.requester,
      assignee: ticket.assignee,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      slaDueAt: ticket.slaDueAt?.toISOString() ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
  }
}
