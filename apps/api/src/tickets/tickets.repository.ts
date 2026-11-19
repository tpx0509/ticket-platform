import { Injectable } from "@nestjs/common"
import { PrismaService } from "src/infra/prisma/prisma.service"
import { AppError } from "src/common/error-codes"
import type { Prisma } from "../generated/prisma/client"
import { CreateTicketInput, ListTicketsQuery, TicketOrder, TicketSort } from "./tickets.schema"

/** 列表只返回这几列，description 这种大字段不进列表 */
const LIST_SELECT = {
    id: true,
    number: true,
    subject: true,
    status: true,
    priority: true,
    createdAt: true,
} as const

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
 * cursor 里除了锚点值，还必须记住「这是按什么顺序生成的」。
 *
 * 少了这两个字段，客户端拿 createdAt 的 cursor 去请求 number 排序时，
 * 过滤条件还在比 createdAt、排序却在比 number，翻页会静默错乱 ——
 * 不报错，只是偶尔少几条，这种 bug 最难查。
 */
type ListCursor = {
    sort: TicketSort
    order: TicketOrder
    /** 主排序键的值：sort=createdAt 时是 ISO 时间串，sort=number 时是编号 */
    value: string | number
    /** tiebreaker。主键值相同时靠它定位，必须和锚点一起进 cursor */
    id: string
}

function encodeCursor(cursor: ListCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * cursor 是客户端原样传回来的字符串，每个字段都得验。
 * 解析失败必须报 400 —— 静默当没传会让客户端一直拿到第一页，
 * 表现成「翻页没反应」，日志里还什么都不剩。
 */
function decodeCursor(raw: string): ListCursor {
    let parsed: unknown
    try {
        parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    } catch {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 格式不合法')
    }

    const c = parsed as Partial<ListCursor>

    if (c?.sort !== 'createdAt' && c?.sort !== 'number') {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 内容不合法')
    }
    if (c?.order !== 'asc' && c?.order !== 'desc') {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 内容不合法')
    }
    if (typeof c?.id !== 'string' || c.id.length === 0) {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 内容不合法')
    }

    // value 的类型取决于 sort：拿一个时间串去比 number，会得到一堆莫名其妙的排序
    if (c.sort === 'createdAt') {
        if (typeof c.value !== 'string' || Number.isNaN(new Date(c.value).getTime())) {
            throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 时间不合法')
        }
    } else if (typeof c.value !== 'number' || !Number.isInteger(c.value) || c.value < 0) {
        throw new AppError('COMMON_VALIDATION_FAILED', 'cursor 编号不合法')
    }

    return { sort: c.sort, order: c.order, value: c.value, id: c.id }
}

/**
 * orderBy：主字段按 order，后面固定追加 id asc 作 tiebreaker。
 * id 是 uuid，本身没有业务含义，方向固定成 asc 就够了 ——
 * 让它跟着 order 变只会多一倍组合，没有收益。
 *
 * 用两个分支而不是 { [sort]: order } 算出来：计算属性的类型是 string 索引签名，
 * Prisma 那套精确类型对不上，而且 sort 一旦多到包含 id 就会自己撞自己。
 */
function buildOrderBy(sort: TicketSort, order: TicketOrder): Prisma.TicketOrderByWithRelationInput[] {
    const primary: Prisma.TicketOrderByWithRelationInput =
        sort === 'createdAt' ? { createdAt: order } : { number: order }
    return [primary, { id: 'asc' }]
}

/**
 * 翻页条件 = 「排在锚点之后的行」。
 *
 * 主字段方向跟着 order 走（降序时找更小的，升序时找更大的）；
 * 主字段相等的那一批，靠 id 继续往后数 —— 所以 id 恒为 gt（因为 tiebreaker 是 asc）。
 * 四个分支全写出来，不用计算属性拼 key，类型能对上，也不容易写反。
 */
function buildCursorWhere(cursor: ListCursor): Prisma.TicketWhereInput {
    if (cursor.sort === 'createdAt') {
        const at = new Date(cursor.value as string)
        return cursor.order === 'desc'
            ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { gt: cursor.id } }] }
            : { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: cursor.id } }] }
    }

    const num = cursor.value as number
    return cursor.order === 'desc'
        ? { OR: [{ number: { lt: num } }, { number: num, id: { gt: cursor.id } }] }
        : { OR: [{ number: { gt: num } }, { number: num, id: { gt: cursor.id } }] }
}

/** 用本页最后一条生成锚点，主字段按当前排序取 */
function encodeFromRow(row: ListRow, sort: TicketSort, order: TicketOrder): string {
    return encodeCursor({
        sort,
        order,
        value: sort === 'createdAt' ? row.createdAt.toISOString() : row.number,
        id: row.id,
    })
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
        const cursor = query.cursor ? decodeCursor(query.cursor) : null

        // 排序变了，旧 cursor 就失去意义。这里必须报错，不能忽略：
        // 忽略的话服务端会拿一个错误的锚点继续翻，结果看着像数据丢了。
        if (cursor && (cursor.sort !== query.sort || cursor.order !== query.order)) {
            throw new AppError(
                'COMMON_VALIDATION_FAILED',
                `cursor 是按 ${cursor.sort} ${cursor.order} 生成的，与本次的 ${query.sort} ${query.order} 不一致，换排序要从第一页重新开始`,
            )
        }

        const rows = await tx.ticket.findMany({
            where: {
                ...where,
                ...(cursor ? buildCursorWhere(cursor) : {}),
            },
            select: LIST_SELECT,
            orderBy: buildOrderBy(query.sort, query.order),
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
                nextCursor: hasNext && last ? encodeFromRow(last, query.sort, query.order) : null,
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
                orderBy: buildOrderBy(query.sort, query.order),
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
                nextCursor: hasNext && last ? encodeFromRow(last, query.sort, query.order) : null,
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
