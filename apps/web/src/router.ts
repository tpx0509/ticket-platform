import { createRouter, createWebHistory } from 'vue-router'

import { orgsLoaded, loadOrgs } from './config'
import { restore, session } from './session'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true },
    },
    { path: '/', redirect: '/tickets' },
    {
      path: '/tickets',
      name: 'tickets',
      component: () => import('./views/TicketListView.vue'),
    },
    {
      path: '/tickets/:id',
      name: 'ticket-detail',
      component: () => import('./views/TicketDetailView.vue'),
      props: true,
    },
    { path: '/:pathMatch(.*)*', redirect: '/tickets' },
  ],
})

/**
 * 守卫里做三件事：恢复登录态、拦未登录、拦已登录又去登录页。
 *
 * restore() 只在首次导航时真正打接口，之后 ready 为 true 直接跳过 ——
 * 每次切页面都调一次 /auth/me 是白白多打请求。
 */
router.beforeEach(async (to) => {
  if (!session.ready) await restore()

  if (to.meta.public) {
    // 已登录还去登录页，直接送回列表
    return session.user ? { name: 'tickets' } : true
  }

  if (!session.user) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  /**
   * 组织列表是后面所有请求的前提 —— 没有 orgId 就拼不出路径。
   * 必须等它回来再放行，否则进列表页那一瞬间会用空 id 打一次 400。
   *
   * 拉失败不拦导航：页面自己会显示错误，总比卡在白屏上什么都不说强。
   */
  if (!orgsLoaded.value) {
    try {
      await loadOrgs()
    } catch {
      /* 忽略：列表页会用空 id 报出自己的错，比这里吞掉更有信息量 */
    }
  }

  return true
})

export default router
