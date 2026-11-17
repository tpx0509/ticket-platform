
import { Controller,Get,Param,Post,Query,Body,Headers } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { ZodValidationPipe } from 'src/common/zod-validation.pipe';
import { z } from 'zod';
import { createTicketSchema, ListTicketsQuery, listTicketsQuerySchema,CreateTicketInput } from './tickets.schema';
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

    @Post()
    create(
        @Param('orgId',new ZodValidationPipe(z.uuid())) orgId:string,
        @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketInput) {
        return this.service.create(orgId,body)
    }
}