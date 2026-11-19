
import { Controller,Get,Headers,Param,Post,Query,Body,Res,UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from 'src/common/error-codes';
import { TicketsService } from './tickets.service';
import { ZodValidationPipe } from 'src/common/zod-validation.pipe';
import { z } from 'zod';
import { JwtAuthGuard } from 'src/common/jwt-auth.guard';
import { OrgMemberGuard } from 'src/common/org-member.guard';
import { RolesGuard } from 'src/common/roles.guard';
import { RateLimitGuard } from 'src/common/rate-limit.guard';
import { RateLimit } from 'src/common/rate-limit.decorator';
import { Roles } from 'src/common/roles.decorator';
import { CurrentUserId } from 'src/common/current-user.decorator';
import { createTicketSchema, ListTicketsQuery, listTicketsQuerySchema,CreateTicketInput } from './tickets.schema';

/**
 * 整个 controller 都要登录才能访问。挂在类上比每个方法挂一遍安全 ——
 * 以后新增接口默认就是受保护的，忘了挂是「多一层保护」而不是「漏一个洞」。
 *
 * 顺序不能反：OrgMemberGuard 依赖 JwtAuthGuard 写入的 req.user，
 * RolesGuard 依赖 OrgMemberGuard 写入的 req.orgMember。
 * RateLimitGuard 放最后，因为它要靠 req.user 决定按谁计数 ——
 * 放前面的话所有请求都只能按 IP 算，登录用户失去了区分度。
 */
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard, RateLimitGuard)
@Controller('orgs/:orgId/tickets')
export class TicketsController {
    constructor(private readonly service: TicketsService) {} 
    @Get()
    list(
        @Param('orgId',new ZodValidationPipe(z.uuid())) orgId:string,
        @Query(new ZodValidationPipe(listTicketsQuerySchema)) query: ListTicketsQuery
    ) {
        return this.service.list(orgId,query)
    }

    @Get(':id')
    detail(
        @Param('id',new ZodValidationPipe(z.uuid())) id:string,
        @Param('orgId',new ZodValidationPipe(z.uuid())) orgId:string) {
        return this.service.detail(orgId,id)
    }

    /** viewer 只读，不能建单。list / detail 不挂，所有成员都能看 */
    @Post()
    @Roles('owner', 'admin', 'agent')
    // 每分钟 5 单。写操作才限流 —— 读接口限流会把正常刷列表的人误伤掉。
    // 数太小不好测也容易误伤，5 是拿来做演示的，真实项目按业务定。
    @RateLimit({ limit: 5, windowSec: 60 })
    async create(
        @Param('orgId',new ZodValidationPipe(z.uuid())) orgId:string,
        @CurrentUserId() userId: string,
        @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketInput,
        // 幂等键走 header 而不是 body：body 是业务数据，key 是传输层重试语义。
        // 混进 body 还会被 createTicketSchema 的 .strict() 拒掉。
        @Headers('idempotency-key') rawKey: string | undefined,
        @Res({ passthrough: true }) res: Response,
    ) {
        const idempotencyKey = parseIdempotencyKey(rawKey);
        const { ticket, replayed } = await this.service.create(orgId, body, userId, idempotencyKey);

        // 状态码仍是 201（客户端可能已经在按 201 写分支了），
        // 重放的事实单独用头告诉它，想区分的话不用改协议。
        if (replayed) res.setHeader('Idempotent-Replay', 'true');
        return ticket;
    }
}

/**
 * Idempotency-Key 是可选的，但传了就必须是 uuid 形状。
 *
 * 这里用 guid() 而不是 uuid()：z.uuid() 会校验 RFC 4122 的版本位
 * （第 13 位必须是 1~8），拿随机 hex 拼出来的 key 会被它拒掉，
 * 而 PG 的 uuid 列只认格式、不认版本。guid() 只查 8-4-4-4-12 的形状。
 *
 * 用 safeParse 而不是 parse：parse 抛的是 ZodError，会被全局过滤器当成
 * 未预期异常，客户端拿到 500 —— 明明是它参数写错了。
 */
function parseIdempotencyKey(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;

    const parsed = z.guid().safeParse(raw.trim());
    if (!parsed.success) {
        throw new AppError('COMMON_VALIDATION_FAILED', 'Idempotency-Key 必须是 uuid', [
            { field: 'Idempotency-Key', message: '格式不合法' },
        ]);
    }
    return parsed.data;
}