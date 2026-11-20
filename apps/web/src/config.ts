/**
 * 当前组织。
 *
 * 以前这里写死了一个 orgId，因为后端没有「我属于哪些组织」的接口。
 * 现在 GET /orgs 有了，登录后拉一次，全局只维护这一份：
 * 页面里所有 orgId 都从这里取，切组织时不用逐个通知视图。
 *
 * 为什么用 reactive 而不是 Pinia：就三个字段，多一个库不划算。
 */
import { reactive, ref } from 'vue'

import { orgApi } from '@/api'
import type { OrgMembership, OrgRole } from '@/api/types'

/** 记住上次选的组织：换个标签页回来还是同一个 */
const STORAGE_KEY = 'ticket.orgId'

export const orgList = ref<OrgMembership[]>([])

/** 拉过一次没有。用它而不是 orgList.length：一个组织都没有的人也是「拉过了」 */
export const orgsLoaded = ref(false)

export const currentOrg = reactive({
  /** 空字符串表示还没加载到。请求前必须判空，否则拼出来的路径会被 zod 拦成 400 */
  id: '',
  name: '',
  role: '' as OrgRole | '',
})

/** 只拉一次。切组织、刷新页面都会又走一遍路由守卫，别每次导航都打接口 */
export async function loadOrgs(force = false): Promise<void> {
  if (!force && orgsLoaded.value) return

  const list = await orgApi.mine()
  orgList.value = list
  orgsLoaded.value = true

  // 优先恢复上次选的；那个组织可能已经退了，退化成第一个
  const saved = localStorage.getItem(STORAGE_KEY)
  const picked = list.find((org) => org.id === saved) ?? list[0]
  if (picked) apply(picked)
}

/** 切换器调用。只改本地状态，重新拉数据由调用方决定（切完一般先回列表页） */
export function switchOrg(id: string): void {
  const found = orgList.value.find((org) => org.id === id)
  if (found) apply(found)
}

/** 退出登录时清掉：换个人登录不能还留着上一个用户的组织 */
export function clearOrgs(): void {
  orgList.value = []
  orgsLoaded.value = false
  currentOrg.id = ''
  currentOrg.name = ''
  currentOrg.role = ''
  localStorage.removeItem(STORAGE_KEY)
}

function apply(org: OrgMembership): void {
  currentOrg.id = org.id
  currentOrg.name = org.name
  currentOrg.role = org.role
  localStorage.setItem(STORAGE_KEY, org.id)
}
