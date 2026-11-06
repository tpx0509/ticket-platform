import { Module } from '@nestjs/common';

import { TicketsController } from './tickets.controller';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

/**
 * 分层：controller 只做 HTTP 适配，service 放业务规则与错误语义，
 * repository 只跟数据库打交道。这样换查询写法不影响业务判断，
 * 换业务规则也不动 SQL。
 */
@Module({
  controllers: [TicketsController],
  providers: [TicketsService, TicketsRepository],
})
export class TicketsModule {}
