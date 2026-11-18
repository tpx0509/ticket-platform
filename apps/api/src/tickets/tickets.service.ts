import { Injectable } from "@nestjs/common";
import { TicketsRepository } from "./tickets.repository";
import { AppError } from "src/common/error-codes";
import { CreateTicketInput, ListTicketsQuery } from "./tickets.schema";

@Injectable()
export class TicketsService {
    constructor(private readonly repo: TicketsRepository) {}

    async list(orgId:string, query: ListTicketsQuery) {
        const res = await this.repo.findList(orgId,query)
        return res
    }
    async detail(orgId: string, id: string) {
        const res = await this.repo.findById(orgId,id)
        if(!res) throw new AppError('TICKET_NOT_FOUND');
        return res
    }
    async create(
        orgId: string,
        body: CreateTicketInput,
        requesterId: string
    ) {
        const res = await this.repo.create(orgId,{ ...body, requesterId })
        return res
    }
}