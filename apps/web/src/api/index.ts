import { downloadFile, http } from './client'
import type { Query } from './client'
import type {
  Attachment,
  CreateTicketBody,
  ListQuery,
  LoginResult,
  OrgMembership,
  TicketDetail,
  TicketListResult,
  User,
} from './types'

/**
 * 接口清单，跟 /api/v1/docs 里的路径一一对应。
 * 全站只有这一个文件拼 URL，页面里不出现字符串路径。
 */

/** ListQuery → 查询串。空值由 client 统一丢掉，这里只管搬 */
function toQuery(q: ListQuery): Query {
  return {
    q: q.q,
    status: q.status,
    priority: q.priority,
    assigneeId: q.assigneeId,
    createdFrom: q.createdFrom,
    createdTo: q.createdTo,
    sort: q.sort,
    order: q.order,
    mode: q.mode,
    pageSize: q.pageSize,
    pageNum: q.pageNum,
    cursor: q.cursor,
  }
}

export const authApi = {
  login(email: string, password: string): Promise<LoginResult> {
    // auth: false —— 登录接口自己就是 401 的来源，不能触发刷新
    return http.send<LoginResult>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
  },

  logout(): Promise<void> {
    return http.send<void>('/auth/logout', { method: 'POST' })
  },

  me(): Promise<User> {
    return http.send<User>('/auth/me')
  },
}

export const orgApi = {
  /** 我加入的组织。登录后第一件事就是问它，拿不到 orgId 什么都请求不了 */
  mine(): Promise<OrgMembership[]> {
    return http.send<OrgMembership[]>('/orgs')
  },
}

export const ticketApi = {
  list(orgId: string, query: ListQuery): Promise<TicketListResult> {
    return http.send<TicketListResult>(`/orgs/${orgId}/tickets`, { query: toQuery(query) })
  },

  detail(orgId: string, id: string): Promise<TicketDetail> {
    return http.send<TicketDetail>(`/orgs/${orgId}/tickets/${id}`)
  },

  /**
   * 建单。
   *
   * idempotencyKey 必须由调用方传，不能在这里 generateUUID ——
   * 那样每次重试都是新 key，幂等等于没做。生成时机是「用户点开弹窗」那一刻。
   */
  create(orgId: string, body: CreateTicketBody, idempotencyKey: string): Promise<TicketDetail> {
    return http.send<TicketDetail>(`/orgs/${orgId}/tickets`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  },
}

export const attachmentApi = {
  list(orgId: string, ticketId: string): Promise<Attachment[]> {
    return http.send<Attachment[]>(`/orgs/${orgId}/tickets/${ticketId}/attachments`)
  },

  upload(orgId: string, ticketId: string, file: File): Promise<Attachment> {
    const form = new FormData()
    // 字段名必须是 file，跟后端 FileInterceptor('file') 对齐
    form.append('file', file)
    return http.send<Attachment>(`/orgs/${orgId}/tickets/${ticketId}/attachments`, {
      method: 'POST',
      form,
    })
  },

  download(orgId: string, ticketId: string, attachmentId: string): Promise<{ blob: Blob; fileName: string }> {
    return downloadFile(`/orgs/${orgId}/tickets/${ticketId}/attachments/${attachmentId}/download`)
  },
}

/** 触发浏览器下载。用 blob URL 而不是直接打开链接 —— 链接带不了 Authorization 头 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
