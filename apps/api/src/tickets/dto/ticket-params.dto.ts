import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 路径参数 `/orgs/:orgId/tickets/:id`。
 *
 * 先校验格式再进数据库：非法 uuid 直接 400，不浪费一次往返。
 * 注意格式合法不等于资源存在 —— 那一步交给查询结果判断（走 404）。
 */
export const ticketParamsSchema = z.object({
  orgId: z.string().regex(UUID_RE, '必须是 uuid'),
  id: z.string().regex(UUID_RE, '必须是 uuid'),
});

export type TicketParams = z.infer<typeof ticketParamsSchema>;
