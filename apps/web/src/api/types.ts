/**
 * 领域类型。
 *
 * 为什么不全靠 openapi.json 生成：zod 在运行时解析，Swagger 反射不到字段，
 * 所以文档里只有路径和请求体，响应结构是空的（@ApiResponse 只写了描述）。
 * 结论是「请求体用生成的，响应结构手写」，生成产物见 ./schema.ts。
 */

import type { operations } from './schema'

export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

export const TICKET_SORTS = ['createdAt', 'number', 'priority'] as const
export type TicketSort = (typeof TICKET_SORTS)[number]

export type SortOrder = 'asc' | 'desc'
export type PageMode = 'offset' | 'cursor'

/** 列表行：后端 LIST_SELECT 的字段，比详情多一个 priorityWeight */
export interface TicketRow {
  id: string
  number: number
  subject: string
  status: TicketStatus
  priority: TicketPriority
  priorityWeight: number
  createdAt: string
}

export const ORGANIZATION_ROLES = ['owner', 'admin', 'agent', 'viewer'] as const
export type OrgRole = (typeof ORGANIZATION_ROLES)[number]

/** GET /orgs 的一项：我在这个组织里是谁、能干什么 */
export interface OrgMembership {
  /** 组织 id，拼接口路径用的就是它 */
  id: string
  name: string
  slug: string
  role: OrgRole
  joinedAt: string | null
}

/** 工单上挂的人。只取这三个字段，别的一概不下发 */
export interface TicketUserRef {
  id: string
  name: string
  email: string
}

/** 详情：和建单接口返回同一个形状，前端只有一套类型 */
export interface TicketDetail {
  id: string
  number: number
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  priorityWeight: number
  requesterId: string
  assigneeId: string | null
  requester: TicketUserRef
  /** 没指派时是 null，不是缺字段 */
  assignee: TicketUserRef | null
  slaDueAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PageMeta {
  mode: PageMode
  pageSize: number
  hasNext: boolean
  nextCursor: string | null
  /** cursor 模式下这三个恒为 null —— 后端刻意不数总数 */
  pageNum: number | null
  total: number | null
  totalPages: number | null
}

export interface TicketListResult {
  data: TicketRow[]
  meta: PageMeta
}

export interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

export interface LoginResult {
  accessToken: string
  tokenType: string
  /** 秒。用来算什么时候该续期 */
  expiresIn: number
  user: Pick<User, 'id' | 'email' | 'name'>
}

export interface Attachment {
  id: string
  fileName: string
  mimeType: string
  size: number
  checksum: string
  createdAt: string
}

export interface ListQuery {
  q?: string
  status?: TicketStatus[]
  priority?: TicketPriority[]
  /** 'unassigned' 表示筛未分配 */
  assigneeId?: string
  createdFrom?: string
  createdTo?: string
  sort?: TicketSort
  order?: SortOrder
  mode?: PageMode
  pageSize?: number
  pageNum?: number
  cursor?: string
}

/**
 * 建单请求体直接取自 openapi.json，不手写。
 *
 * 后端改字段时，重新跑 `pnpm --filter @ticket/web openapi` 就会在这里编译报错，
 * 比「文档和代码各写一份、谁也发现不了不一致」可靠得多。
 *
 * 列表查询参数没法这么干：@ApiQuery 生成出来 status 是单值 string，
 * 而实际是「同名参数可重复传」的数组语义，OpenAPI 3.0 表达不了，
 * 所以那部分仍然手写（见上面 ListQuery）。
 */
export type CreateTicketBody =
  operations['TicketsController_create']['requestBody']['content']['application/json']
