import { createRouter, createWebHistory } from 'vue-router'

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
  return true
})

export default router
