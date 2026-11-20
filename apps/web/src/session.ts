import { computed, reactive } from 'vue'

import { authApi } from '@/api'
import { tokenStore } from '@/api/client'
import type { User } from '@/api/types'

/**
 * 登录态就两个字段，没必要上 Pinia。
 *
 * accessToken 不放在状态里：它只在请求头用一下，client 直接从 localStorage 读，
 * 这里再存一份就多一个要同步的副本。状态只管「当前是谁」，给页面渲染用。
 */
export const session = reactive({
  user: null as User | null,
  /** restore 跑完没有。路由守卫靠它判断要不要等 */
  ready: false,
})

export const isLoggedIn = computed(() => session.user !== null)

export async function login(email: string, password: string): Promise<void> {
  const result = await authApi.login(email, password)
  // refreshToken 由后端塞进 httpOnly cookie，JS 拿不到也不需要拿
  tokenStore.set(result.accessToken)
  session.user = await authApi.me()
}

/**
 * 刷新页面后恢复登录态。
 *
 * 会真实打一次 /auth/me：localStorage 里有 token 不代表有效，
 * 可能已经过期或用户被删。401 时 client 会先尝试 refresh，
 * 失败才走到 catch，把本地 token 清掉。
 */
export async function restore(): Promise<void> {
  if (session.ready) return
  if (!tokenStore.get()) {
    session.ready = true
    return
  }
  try {
    session.user = await authApi.me()
  } catch {
    tokenStore.clear()
    session.user = null
  } finally {
    session.ready = true
  }
}

export async function logout(): Promise<void> {
  try {
    // 后端会撤销 refreshToken 并清 cookie；失败也要把本地清干净，
    // 否则用户会卡在「点了退出还显示登录着」的状态
    await authApi.logout()
  } catch {
    /* 忽略：本地清理比服务端撤销更重要 */
  } finally {
    tokenStore.clear()
    session.user = null
  }
}
