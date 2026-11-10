import { Injectable } from "@nestjs/common"
import { PrismaService } from "src/infra/prisma/prisma.service"

@Injectable()
export class TicketsRepository {
    constructor(private readonly prisma: PrismaService) {
    }
    findList(orgId:string, query: { status?:string; priority?:string; limit?:string }) {
        return this.prisma.withTenant(orgId,(tx) => {
            return tx.ticket.findMany({
                where: { 
                    status:query.status,
                    priority:query.priority,
                    orgId,
                    deletedAt: null
                },
                select: { id:true,number:true,subject:true,status:true,priority:true,createdAt:true},
                orderBy : [ { createdAt : 'desc' },{ id : 'asc'}],
                take : Math.min(Number(query.limit) || 10,100)
            })
        })
    }
    findById(orgId:string,id:string) {
        return this.prisma.withTenant(orgId,(tx) => {
            return tx.ticket.findFirst({
                where: { 
                    id,
                    orgId,
                    deletedAt: null
                },
                select: { id:true,number:true,subject:true,status:true,priority:true,createdAt:true},
            })
        })
    }
    create(orgId:string, params: any) {
        return this.prisma.withTenant(orgId,async (tx) => {
            // 先获取当前组织的自增number，然后+1
            const agg = await tx.ticket.aggregate({
                where: { orgId },
                _max : { number : true }
            })
            const next = (agg._max.number ?? 0) + 1;
            return tx.ticket.create({
                data: {
                    orgId,
                    requesterId:params.requesterId,
                    subject : params.subject,
                    priority: params.priority,
                    description: params.description,
                    number: next
                }
            })
        })
    }
}