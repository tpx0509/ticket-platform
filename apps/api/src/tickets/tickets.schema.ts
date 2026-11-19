
import { z } from 'zod';

const pageSizeSchema = z.coerce.number().int().min(1).max(100);

/** 不传 pageSize 时的默认条数 */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * 可排序的字段。用 as const + 派生类型，而不是到处写 string：
 * 打错字在编译期就报，且 orderBy 那边能直接拿到字面量类型。
 *
 * priority 不能直接按列排序 —— 那一列是 text，数据库按字典序排出来是
 * high < low < normal < urgent。实际排序走的是 generated column priorityWeight。
 */
export const TICKET_SORT_FIELDS = ['createdAt', 'number', 'priority'] as const;
export type TicketSort = (typeof TICKET_SORT_FIELDS)[number];

export const TICKET_ORDERS = ['asc', 'desc'] as const;
export type TicketOrder = (typeof TICKET_ORDERS)[number];

/** 纯日期写法（2026-07-31），用来和「带时分秒的完整时间串」区分 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 业务时区。用户在北京，前端传「2026-07-15」时想的是本地那一天，
 * 不是 UTC 的那一天。库里存的是 timestamptz（统一 UTC），
 * 所以边界值要按 +08:00 换算，否则会整体差 8 小时 ——
 * 表现为「选今天查不到今天的单」，而且前端看不出哪里错了。
 */
const BUSINESS_TZ = '+08:00';

/**
 * 时间参数按字符串接进来，不用 z.coerce.date()。
 * 原因：coerce 之后原始形状就丢了，而下面要判断「这是纯日期还是完整时间」——
 * 纯日期的结束边界得推到次日零点，否则 createdTo=2026-07-31 会把当天整天漏掉。
 */
const dateParamSchema = z
    .string()
    .trim()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), '时间格式不合法，例如 2026-07-01');

/** 起始边界：纯日期补成本地零点，其余原样转 Date */
function toRangeStart(raw?: string): Date | undefined {
    if (!raw) return undefined;
    return new Date(DATE_ONLY.test(raw) ? `${raw}T00:00:00${BUSINESS_TZ}` : raw);
}

/**
 * 结束边界：纯日期补到「次日零点」，配 lt 就是「含当天整天」。
 * 带时分秒的原样返回，调用方自己负责精确到秒。
 */
function toRangeEnd(raw?: string): Date | undefined {
    if (!raw) return undefined;
    if (!DATE_ONLY.test(raw)) return new Date(raw);
    const d = new Date(`${raw}T00:00:00${BUSINESS_TZ}`);
    // 加一天是按 UTC 加，跨时区时日期算术用 UTC 最稳
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
}

/**
 * 列表入参。两种分页方式共用一个 schema，由 transform 归一化成统一形状：
 *
 *   ?pageNum=2&pageSize=10    → offset 模式
 *   ?cursor=eyJjcmVhdGVk...   → cursor 模式
 *
 * 归一化放在这里的原因：默认值、参数别名、互斥规则都属于「入参处理」，
 * 一次做完之后 service 和 repository 拿到的就是干净数据，不用各自判断。
 */
export const listTicketsQuerySchema = z
    .object({
        status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        /** 每页条数 */
        pageSize: pageSizeSchema.optional(),
        /** 同 pageSize，旧名字，保留兼容 */
        limit: pageSizeSchema.optional(),
        /** offset 模式：第几页，从 1 开始 */
        pageNum: z.coerce.number().int().min(1).optional(),
        /** cursor 模式：上一页给的锚点。不传就是第一页 */
        cursor: z.string().min(1).optional(),
        /** 显式指定分页方式，默认 offset。传了 cursor 时自动按 cursor 处理 */
        mode: z.enum(['offset', 'cursor']).optional(),
        /** 排序字段，默认按创建时间 */
        sort: z.enum(TICKET_SORT_FIELDS).default('createdAt'),
        /** 排序方向，默认倒序（最新的在前） */
        order: z.enum(TICKET_ORDERS).default('desc'),
        /**
         * 关键字，搜标题和描述。max(50) 不是随手写的：
         * ILIKE '%...%' 前面带通配符用不上索引，字符串越长扫得越慢，
         * 不设上限等于给了一个「用超长字符串拖垮库」的入口。
         */
        q: z.string().trim().min(1).max(50).optional(),
        /** 创建时间起，含 */
        createdFrom: dateParamSchema.optional(),
        /** 创建时间止，纯日期时含当天整天 */
        createdTo: dateParamSchema.optional(),
        /**
         * 负责人。query 参数传不了 null，所以用 unassigned 当哨兵值：
         * 不传 = 不筛，unassigned = 筛未分配，uuid = 筛某个人的。
         */
        assigneeId: z.union([z.literal('unassigned'), z.uuid()]).optional(),
    })
    .superRefine((q, ctx) => {
        // 两个名字都传了但值不一样，说明调用方自己没搞清楚要什么，直接报错
        if (q.pageSize !== undefined && q.limit !== undefined && q.pageSize !== q.limit) {
            ctx.addIssue({
                code: 'custom',
                path: ['pageSize'],
                message: 'pageSize 与 limit 只能传一个，或传相同的值',
            });
        }
        // cursor 和 pageNum 是两种模式，混用没有意义，静默忽略会让调用方以为生效了
        if (q.cursor !== undefined && (q.pageNum ?? 1) > 1) {
            ctx.addIssue({
                code: 'custom',
                path: ['cursor'],
                message: 'cursor 与 pageNum 不能同时使用',
            });
        }
        // 明确说要用 offset，却把 cursor 也塞进来了，这是自相矛盾的请求
        if (q.cursor !== undefined && q.mode === 'offset') {
            ctx.addIssue({
                code: 'custom',
                path: ['mode'],
                message: '传了 cursor 就不能指定 mode=offset',
            });
        }
        // 时间写反一定查不到东西。静默返回空列表会被当成「没有数据」，而不是「参数写错了」
        if (q.createdFrom !== undefined && q.createdTo !== undefined
            && new Date(q.createdFrom).getTime() > new Date(q.createdTo).getTime()) {
            ctx.addIssue({
                code: 'custom',
                path: ['createdTo'],
                message: '结束时间不能早于开始时间',
            });
        }
    })
    .transform((v) => ({
        status: v.status,
        priority: v.priority,
        pageSize: v.pageSize ?? v.limit ?? DEFAULT_PAGE_SIZE,
        pageNum: v.pageNum ?? 1,
        cursor: v.cursor,
        // 带 cursor 的请求一定是想接着上一页翻，不管 mode 有没有写
        mode: (v.cursor !== undefined ? 'cursor' : (v.mode ?? 'offset')) as 'cursor' | 'offset',
        sort: v.sort,
        order: v.order,
        q: v.q,
        /**
         * 三态，靠 undefined 和 null 区分：
         * undefined = 不筛，null = 筛未分配，string = 筛指定的人。
         * Prisma 那边 assigneeId: undefined 会被整条忽略，null 生成 IS NULL，正好对上。
         */
        assigneeId: v.assigneeId === undefined
            ? undefined
            : v.assigneeId === 'unassigned' ? null : v.assigneeId,
        createdFrom: toRangeStart(v.createdFrom),
        createdTo: toRangeEnd(v.createdTo),
    }));

export const createTicketSchema  = z.object({
    subject: z.string().min(1).max(100),
    description : z.string().min(1).max(500),
    priority: z.enum(['low','normal','high','urgent']).optional()
}).strict()

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>
export type CreateTicketInput = z.infer<typeof createTicketSchema>
