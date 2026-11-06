import { Controller, Get, Param } from '@nestjs/common';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type TicketParams, ticketParamsSchema } from './dto/ticket-params.dto';
import type { TicketDetailResponse } from './dto/ticket-detail.dto';
import { TicketsService } from './tickets.service';

/**
 * 路径带 orgId 是契约决定的（docs/api-v1.md），不是可选风格。
 * 服务端据此确定租户，再叠一层 membership 校验 —— 后者等鉴权接上再补。
 */
@Controller('orgs/:orgId/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** GET /api/v1/orgs/:orgId/tickets/:id */
  @Get(':id')
  detail(
    @Param(new ZodValidationPipe(ticketParamsSchema)) params: TicketParams,
  ): Promise<TicketDetailResponse> {
    return this.tickets.getById(params.orgId, params.id);
  }
}
