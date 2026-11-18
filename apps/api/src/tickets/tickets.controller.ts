
import { Controller,Get,Param,Post,Query,Body,UseGuards } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { ZodValidationPipe } from 'src/common/zod-validation.pipe';
import { z } from 'zod';
import { JwtAuthGuard } from 'src/common/jwt-auth.guard';
import { OrgMemberGuard } from 'src/common/org-member.guard';
import { RolesGuard } from 'src/common/roles.guard';
import { Roles } from 'src/common/roles.decorator';
import { CurrentUserId } from 'src/common/current-user.decorator';
import { createTicketSchema, ListTicketsQuery, listTicketsQuerySchema,CreateTicketInput } from './tickets.schema';

/**
 * 整个 controller 都要登录才能访问。挂在类上比每个方法挂一遍安全 ——
 * 以后新增接口默认就是受保护的，忘了挂是「多一层保护」而不是「漏一个洞」。
 *
 * 顺序不能反：OrgMemberGuard 依赖 JwtAuthGuard 写入的 req.user，
 * RolesGuard 依赖 OrgMemberGuard 写入的 req.orgMember。
 */
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
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
    create(
        @Param('orgId',new ZodValidationPipe(z.uuid())) orgId:string,
        @CurrentUserId() userId: string,
        @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketInput) {
        return this.service.create(orgId,body,userId)
    }
}