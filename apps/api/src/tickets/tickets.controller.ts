
import { Controller,Get,Headers,Param,Post,Query,Body,Res,UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
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
 * Swagger 装饰器只是文档，不参与运行时校验 —— 校验仍然是 zod 那一层。
 * 但两边的字段名必须一致，否则文档能调通、实际 400，比没文档还坑。
 * zod 没法被 Swagger 反射出来（它是运行时解析，不是类上的元数据），
 * 所以 path / query / body 都得手写一遍。
 */
@ApiTags('tickets')
@ApiBearerAuth('access-token')
@ApiParam({ name: 'orgId', description: '组织 id', format: 'uuid', example: '0748a20e-edee-47b8-8d8c-b315aa688be4' })
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
    @ApiOperation({ summary: '工单列表', description: '分页（offset / cursor 两种模式）+ 排序 + 多条件筛选' })
    @ApiQuery({ name: 'status', required: false, description: '状态，可重复传', type: String })
    @ApiQuery({ name: 'priority', required: false, description: '优先级，可重复传', enum: ['low', 'normal', 'high', 'urgent'] })
    @ApiQuery({ name: 'q', required: false, description: '关键字，搜标题和描述', type: String, example: '登录' })
    @ApiQuery({ name: 'assigneeId', required: false, description: '负责人 id；传 unassigned 筛未分配', type: String })
    @ApiQuery({ name: 'createdFrom', required: false, description: '创建时间起，2026-07-01 或完整时间串', type: String })
    @ApiQuery({ name: 'createdTo', required: false, description: '创建时间止，纯日期时含当天整天', type: String })
    @ApiQuery({ name: 'sort', required: false, enum: ['createdAt', 'number', 'priority'], description: '排序字段' })
    @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'], description: '排序方向' })
    @ApiQuery({ name: 'pageSize', required: false, description: '每页条数，最大 100', type: Number, example: 10 })
    @ApiQuery({ name: 'pageNum', required: false, description: 'offset 模式的页码，从 1 开始', type: Number })
    @ApiQuery({ name: 'cursor', required: false, description: 'cursor 模式的游标，取上一页的 nextCursor', type: String })
    @ApiQuery({ name: 'mode', required: false, enum: ['offset', 'cursor'], description: '分页模式，默认 offset' })
    list(
        @Param('orgId',new ZodValidationPipe(z.uuid())) orgId:string,
        @Query(new ZodValidationPipe(listTicketsQuerySchema)) query: ListTicketsQuery
    ) {
        return this.service.list(orgId,query)
    }

    @Get(':id')
    @ApiOperation({ summary: '工单详情' })
    @ApiParam({ name: 'id', description: '工单 id', format: 'uuid' })
    @ApiResponse({ status: 404, description: '不存在，或不属于当前组织（两种情况都返回 404）' })
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
    @ApiOperation({ summary: '建单', description: '需要 owner / admin / agent 角色，viewer 返回 403' })
    @ApiHeader({
        name: 'Idempotency-Key',
        required: false,
        description: '客户端生成的 uuid。同一个 key 重发只会建一单，重放时响应带 Idempotent-Replay: true',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['subject', 'description'],
            additionalProperties: false,
            properties: {
                subject: { type: 'string', minLength: 1, maxLength: 100, example: '打印机连不上' },
                description: { type: 'string', minLength: 1, maxLength: 500, example: '重启后依然报 E403' },
                priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
            },
        },
    })
    @ApiResponse({ status: 201, description: '建单成功（重放也是 201，靠响应头区分）' })
    @ApiResponse({ status: 429, description: '超出限流：每分钟 5 单，响应头 Retry-After 是剩余秒数' })
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