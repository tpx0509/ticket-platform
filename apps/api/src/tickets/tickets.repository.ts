import { Injectable } from "@nestjs/common"
import { PrismaService } from "src/infra/prisma/prisma.service"
import { AppError } from "src/common/error-codes"
import type { Prisma } from "../generated/prisma/client"
import { CreateTicketInput, ListTicketsQuery } from "./tickets.schema"

/** cursor 里只放定位用的最小信息：上一页最后一条的排序键 */
type ListCursor = { createdAt: string; id: string }

/** 列表只返回这几列，description 这种大字段不进列表 */
const LIST_SELECT = {
    id: true,
    number: true,
    subject: true,
    status: true,
    priority: true,
    createdAt: true,
} as const

/**
 * 排序固定：时间倒序，同一时刻用 id 升序兜底。
 * 那个 id 不是装饰 —— 库里存在同一秒创建的多条工单，
 * 只按 createdAt 排会让它们的相对顺序不确定，翻页必然重或漏。
 */
const LIST_ORDER_BY: Prisma.TicketOrderByWithRelationInput[] = [
    { createdAt: 'desc' },
    { id: 'asc' },
]

type ListRow = Prisma.TicketGetPayload<{ select: typeof LIST_SELECT }>

/**
 * 两种分页共用一个 meta 形状，前端只需要一张类型表：
 * total / pageNum / totalPages 在 cursor 模式下恒为 null —— 那是它的特性，
 * 不是没实现：cursor 分页本来就不去数总数，否则又要把 count(*) 加回来。
 */
export type ListPageMeta = {
    mode: 'offset' | 'cursor'
    pageSize: number
    hasNext: boolean
    /** 下一页的锚点。两种模式都给，方便客户端随时切到 cursor */
    nextCursor: string | null
    pageNum: number | null
    total: number | null
    totalPages: number | null
}

export type ListPage = { data: ListRow[]; meta: ListPageMeta }

/**
 * 编码成 base64url。
 * 不直接把 JSON 扔给客户端有两个原因：
 * 一是它出现在 JSON 响应里会变成一堆 \" 转义，客户端和日志都难读；
 * 二是 base64 之后它就是一段不透明字符串，没人会想着手改它拼参数。
 */
function encodeCursor(cursor: ListCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * cursor 是客户端原样传回来的字符串，形状和日期都得验。
 * 解析失败必须报 400 —— 静默当没传会让客户端一直拿到第一页，
 * 表现成「翻页没反应」，日志里还什么都不剩。
 */
function decodeCursor(raw?: string): ListCursor | null {
    if (!raw) return null

    let parsed: unknown
    try {
        parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    } catch {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 格式不合法')
    }

    const c = parsed as Partial<ListCursor>
    if (typeof c?.createdAt !== 'string' || typeof c?.id !== 'string') {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 内容不合法')
    }
    if (Number.isNaN(new Date(c.createdAt).getTime())) {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 时间不合法')
    }

    return { createdAt: c.createdAt, id: c.id }
}

@Injectable()
export class TicketsRepository {
    constructor(private readonly prisma: PrismaService) {
    }

    /**
     * 两种分页共用一个入口，筛选条件共用，只有翻页方式不同。
     * 模式已经在 schema 里归一化过，这里不用再判断参数谁先谁后。
     */
    findList(orgId: string, query: ListTicketsQuery) {
        return this.prisma.withTenant(orgId, async (tx): Promise<ListPage> => {
            const where: Prisma.TicketWhereInput = {
                orgId,
                deletedAt: null,
                status: query.status,
                priority: query.priority,
            }

            if (query.mode === 'cursor') {
                return this.listByCursor(tx, where, query)
            }
            return this.listByOffset(tx, where, query)
        })
    }

    /**
     * cursor（keyset）：条件里给的是「从哪一条之后」，数据库能直接用索引定位，
     * 翻到第 1 万页和翻第 1 页的成本一样。代价是不能跳页、拿不到总数。
     */
    private async listByCursor(
        tx: Prisma.TransactionClient,
        where: Prisma.TicketWhereInput,
        query: ListTicketsQuery,
    ): Promise<ListPage> {
        const cursor = decodeCursor(query.cursor)

        const rows = await tx.ticket.findMany({
            where: {
                ...where,
                // 排序是 createdAt desc + id asc，所以「下一页」= 时间更早，
                // 或者时间相同但 id 更大。两个条件必须一起：
                // 只写 createdAt < ... 会把同一时刻的其余几条整个跳过。
                ...(cursor
                    ? {
                        OR: [
                            { createdAt: { lt: new Date(cursor.createdAt) } },
                            { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
                        ],
                    }
                    : {}),
            },
            select: LIST_SELECT,
            orderBy: LIST_ORDER_BY,
            // 多取一条当哨兵，用来判断还有没有下一页
            take: query.pageSize + 1,
        })

        const hasNext = rows.length > query.pageSize
        const data = hasNext ? rows.slice(0, query.pageSize) : rows
        // 锚点是本页最后一条，不是哨兵 —— 用哨兵当锚点会把它自己跳过
        const last = data[data.length - 1]

        return {
            data,
            meta: {
                mode: 'cursor',
                pageSize: query.pageSize,
                hasNext,
                nextCursor: hasNext && last
                    ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
                    : null,
                // cursor 模式不查总数，这三项为空是设计如此
                pageNum: null,
                total: null,
                totalPages: null,
            },
        }
    }

    /**
     * offset：skip + take。能跳页，但要额外一次 count 才知道总数和总页数。
     * count 和 findMany 必须在同一个事务里，否则一个读到新数据、一个读到旧数据，
     * 会出现「共 104 条」但翻到末页只有 3 条这类对不上的情况。
     */
    private async listByOffset(
        tx: Prisma.TransactionClient,
        where: Prisma.TicketWhereInput,
        query: ListTicketsQuery,
    ): Promise<ListPage> {
        const total = await tx.ticket.count({ where })
        const skip = (query.pageNum - 1) * query.pageSize
        const totalPages = Math.ceil(total / query.pageSize)

        // 页码越界时不必再查一次：skip 已经超过总数，结果必然是空数组
        const data: ListRow[] = skip >= total
            ? []
            : await tx.ticket.findMany({
                where,
                select: LIST_SELECT,
                orderBy: LIST_ORDER_BY,
                skip,
                take: query.pageSize,
            })

        const hasNext = query.pageNum < totalPages
        const last = data[data.length - 1]

        return {
            data,
            meta: {
                mode: 'offset',
                pageNum: query.pageNum,
                pageSize: query.pageSize,
                total,
                totalPages,
                hasNext,
                // 顺带给出锚点：客户端想从这一页切到 cursor 模式时直接拿去用
                nextCursor: hasNext && last
                    ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
                    : null,
            },
        }
    }

    findById(orgId: string, id: string) {
        return this.prisma.withTenant(orgId, (tx) => {
            return tx.ticket.findFirst({
                where: {
                    id,
                    orgId,
                    deletedAt: null
                },
                select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true },
            })
        })
    }

    // 交叉类型：用户填的字段 + 身份字段，分开表达，边界清楚
    create(orgId: string, params: CreateTicketInput & { requesterId: string }) {
        return this.prisma.withTenant(orgId, async (tx) => {
            // 先获取当前组织的自增number，然后+1
            const agg = await tx.ticket.aggregate({
                where: { orgId },
                _max: { number: true }
            })
            const next = (agg._max.number ?? 0) + 1;
            return tx.ticket.create({
                data: {
                    orgId,
                    requesterId: params.requesterId,
                    subject: params.subject,
                    priority: params.priority,
                    description: params.description,
                    number: next
                }
            })
        })
    }
}
