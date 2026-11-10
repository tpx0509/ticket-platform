
import { Controller,Get,Param,Post,Query,Body } from '@nestjs/common';
import { TicketsService } from './tickets.service';
@Controller('orgs/:orgId/tickets')
export class TicketsController {
    constructor(private readonly service: TicketsService) {} 
    @Get()
    list(@Param('orgId') orgId:string,@Query() query: any) {
        return this.service.list(orgId,query)
    }

    @Get(':id')
    detail(@Param('id') id:string,@Param('orgId') orgId:string) {
        return this.service.detail(orgId,id)
    }

    @Post()
    create(@Param('orgId') orgId:string,@Body() body: Record<string, unknown>) {
        return this.service.create(orgId,body)
    }
}