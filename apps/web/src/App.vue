<script setup lang="ts">
import { ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { currentOrg, orgList, switchOrg } from './config'
import { logout, session } from './session'

const route = useRoute()
const router = useRouter()

const isPublic = computed(() => route.meta.public === true)
const orgName = computed(() => currentOrg.name)

async function handleLogout(): Promise<void> {
  await logout()
  ElMessage.success('已退出')
  await router.push({ name: 'login' })
}

/**
 * 切组织。
 *
 * el-select 的 change 回调参数类型很宽（string | number | boolean | undefined），
 * 直接当 string 用会被 typecheck 拦，所以先收窄。
 * 切完全都回列表页：当前详情页的工单属于旧组织，留在原地只会 404。
 */
async function handleSwitchOrg(value: unknown): Promise<void> {
  if (typeof value !== 'string') return
  switchOrg(value)
  ElMessage.success(`已切换到 ${currentOrg.name}`)
  await router.push({ name: 'tickets' })
}
</script>

<template>
  <!-- 登录页不带外壳，避免用户还没登录就看到导航 -->
  <RouterView v-if="isPublic" />

  <div v-else class="shell">
    <header class="topbar">
      <div class="brand" @click="router.push({ name: 'tickets' })">
        <span class="brand-mark">T</span>
        <span class="brand-text">工单台</span>
      </div>

      <nav class="nav">
        <RouterLink :to="{ name: 'tickets' }" class="nav-link">工单</RouterLink>
      </nav>

      <div class="topbar-right">
        <el-select
          v-if="orgList.length > 1"
          size="small"
          class="org-select"
          :model-value="currentOrg.id"
          @change="handleSwitchOrg"
        >
          <el-option v-for="org in orgList" :key="org.id" :label="org.name" :value="org.id" />
        </el-select>
        <el-tag v-else size="small" effect="plain" type="info">{{ orgName }}</el-tag>
        <el-dropdown trigger="click" @command="handleLogout">
          <span class="user-trigger">
            {{ session.user?.name ?? session.user?.email }}
            <el-icon class="caret"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>{{ session.user?.email }}</el-dropdown-item>
              <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <main class="page">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  background: var(--app-bg);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 28px;
  height: 56px;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid var(--app-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--el-color-primary);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
}

.brand-text {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.nav {
  display: flex;
  gap: 4px;
}

.nav-link {
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--el-text-color-regular);
  font-size: 14px;
  text-decoration: none;
}

.nav-link:hover {
  background: var(--el-fill-color-light);
}

.nav-link.router-link-active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-weight: 500;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}

.org-select {
  width: 132px;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 14px;
  color: var(--el-text-color-regular);
  outline: none;
}

.caret {
  font-size: 12px;
}

.page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 24px;
}
</style>
