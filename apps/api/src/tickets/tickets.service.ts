import { Injectable } from "@nestjs/common";
import { TicketsRepository } from "./tickets.repository";
import { AppError } from "src/common/error-codes";

@Injectable()
export class TicketsService {
    constructor(private readonly repo: TicketsRepository) {}

    async list(orgId:string, query: { status?:string; priority?:string; limit?:string }) {
        const res = await this.repo.findList(orgId,query)
        return res
    }
    async detail(orgId: string, id: string) {
        const res = await this.repo.findById(orgId,id)
        if(!res) throw new AppError('TICKET_NOT_FOUND');
        return res
    }
    async create(orgId: string, body: Record<string, unknown>) {
        const res = await this.repo.create(orgId,body)
        return res
    }
}