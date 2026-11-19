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
    /**
     * 建单。
     *
     * 幂等的实现只有一句话：带 key 就直接插，让唯一索引兜底，冲突了说明是重发。
     * 不能写成「先查有没有、没有就插」—— 两个并发请求会同时查到「没有」，
     * 然后都去插，问题只是从「插两条」变成「一条成功一条报 500」。
     *
     * catch 必须在 repo.create 外面。唯一冲突会让 PG 把整个事务置为 aborted，
     * 在事务里再执行任何 SQL 都会报 current transaction is aborted；
     * 异常冒出来时事务已经回滚结束，这时才能开新事务回查。
     */
    async create(
        orgId: string,
        body: CreateTicketInput,
        requesterId: string,
        idempotencyKey?: string,
    ): Promise<{ ticket: unknown; replayed: boolean }> {
        try {
            const ticket = await this.repo.create(orgId, { ...body, requesterId, idempotencyKey });
            return { ticket, replayed: false };
        } catch (error) {
            if (idempotencyKey && isIdempotencyConflict(error)) {
                const existing = await this.repo.findByIdempotencyKey(orgId, idempotencyKey);
                if (existing) return { ticket: existing, replayed: true };
            }
            throw error;
        }
    }
}

/**
 * Prisma 的唯一约束冲突是 P2002。
 *
 * 但 meta 的形状很飘：有时是 { target: ['org_id','idempotency_key'] }，
 * 有时是 { constraint: 'tickets_org_id_idempotency_key_key' }（PG 驱动直接回约束名）。
 * 与其一个个猜字段，把 meta 和 message 拼起来找列名 —— P2002 的 message 里
 * 一定带着出错的那个约束/字段名，别的唯一冲突（比如 number）不会含 idempotency_key。
 */
function isIdempotencyConflict(error: unknown): boolean {
    const candidate = error as { code?: string; meta?: unknown; message?: string };
    if (candidate?.code !== 'P2002') return false;

    const haystack = `${JSON.stringify(candidate.meta ?? '')} ${candidate.message ?? ''}`;
    return haystack.includes('idempotency_key');
}