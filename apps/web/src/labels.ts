import type { TicketPriority, TicketSort, TicketStatus } from '@/api/types'

/**
 * 枚举的中文名与颜色集中在这里。
 *
 * 散在模板里写 v-if 判断颜色，改文案就得全局搜。
 * 用 Record<枚举, ...> 还有个好处：后端加了新状态，TS 会在这里报缺键。
 */

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: '待处理',
  pending: '处理中',
  resolved: '已解决',
  closed: '已关闭',
}

export const STATUS_TAG: Record<TicketStatus, 'primary' | 'success' | 'warning' | 'info' | 'danger'> = {
  open: 'danger',
  pending: 'warning',
  resolved: 'success',
  closed: 'info',
}

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
}

export const PRIORITY_TAG: Record<TicketPriority, 'primary' | 'success' | 'warning' | 'info' | 'danger'> = {
  low: 'info',
  normal: 'primary',
  high: 'warning',
  urgent: 'danger',
}

export const SORT_LABEL: Record<TicketSort, string> = {
  createdAt: '创建时间',
  number: '编号',
  priority: '优先级',
}

/** 2026-08-15T02:02:54.037Z → 2026-08-15 10:02:54（本地时区） */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
