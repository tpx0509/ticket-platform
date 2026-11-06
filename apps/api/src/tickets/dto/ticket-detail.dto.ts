/**
 * 工单详情响应。字段与 docs/api-v1.md 的 `GET /orgs/:orgId/tickets/:id` 对齐。
 *
 * 时间统一转成 ISO 8601 字符串带时区 —— 让契约里的类型固定下来，
 * 不依赖 JSON.stringify 对 Date 的隐式处理。
 */
export interface TicketDetailResponse {
  id: string;
  number: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  source: string;
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  firstResponseAt: string | null;
  slaDueAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
