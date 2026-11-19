
import { z } from 'zod';

const pageSizeSchema = z.coerce.number().int().min(1).max(100);

/** 不传 pageSize 时的默认条数 */
export const DEFAULT_PAGE_SIZE = 10;

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
    })
    .transform((q) => ({
        status: q.status,
        priority: q.priority,
        pageSize: q.pageSize ?? q.limit ?? DEFAULT_PAGE_SIZE,
        pageNum: q.pageNum ?? 1,
        cursor: q.cursor,
        // 带 cursor 的请求一定是想接着上一页翻，不管 mode 有没有写
        mode: (q.cursor !== undefined ? 'cursor' : (q.mode ?? 'offset')) as 'cursor' | 'offset',
    }));

export const createTicketSchema  = z.object({
    subject: z.string().min(1).max(100),
    description : z.string().min(1).max(500),
    priority: z.enum(['low','normal','high','urgent']).optional()
}).strict()

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>
export type CreateTicketInput = z.infer<typeof createTicketSchema>
