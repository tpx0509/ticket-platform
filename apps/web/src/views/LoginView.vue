<script setup lang="ts">
import { Lock, User } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/client'
import { login } from '@/session'

const route = useRoute()
const router = useRouter()

const formRef = ref<FormInstance>()
const loading = ref(false)
const errorText = ref('')
const requestId = ref('')

// 预填一个能用的账号，省得每次查 seed 文件
const form = reactive({
  email: 'test-1117@example.com',
  password: 'secret123',
})

const rules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不对', trigger: 'blur' },
  ],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  errorText.value = ''
  requestId.value = ''

  try {
    await login(form.email.trim(), form.password)
    ElMessage.success('登录成功')
    // 带着来的 redirect 回原页面，没有就去列表
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/tickets'
    await router.replace(redirect)
  } catch (error) {
    // errors 走统一异常过滤器，这里拿到的已经是人话 + 一个可追溯的 requestId
    if (error instanceof ApiError) {
      errorText.value = error.message
      requestId.value = error.requestId
    } else {
      errorText.value = error instanceof Error ? error.message : '登录失败'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="aside">
      <div class="aside-inner">
        <div class="logo">
          <span class="logo-mark">T</span>
          <span>工单台</span>
        </div>
        <h1>把工单收进一个地方</h1>
        <p>多租户隔离、细粒度权限、游标分页、附件直传，后端接口已经在跑了。</p>
        <ul>
          <li>组织内成员才能看到组织内的单</li>
          <li>viewer 只读，agent 及以上才能建单</li>
          <li>列表支持筛选、排序、两种分页模式</li>
        </ul>
      </div>
    </section>

    <section class="panel">
      <div class="panel-inner">
        <h2>登录</h2>
        <p class="sub">用 seed 账号，或者你自己注册的账号</p>

        <el-alert v-if="errorText" type="error" :closable="false" class="error">
          <div>{{ errorText }}</div>
          <div v-if="requestId" class="req-id">requestId: {{ requestId }}</div>
        </el-alert>

        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
          <el-form-item label="邮箱" prop="email">
            <el-input v-model="form.email" placeholder="you@example.com" size="large" :prefix-icon="User" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              size="large"
              :prefix-icon="Lock"
              @keyup.enter="submit"
            />
          </el-form-item>
          <el-button type="primary" size="large" class="submit" :loading="loading" @click="submit">
            登录
          </el-button>
        </el-form>

        <div class="hint">
          <div class="hint-title">可用账号</div>
          <div><code>test-1117@example.com</code> / <code>secret123</code> — 云启 agent</div>
          <div><code>user01@example.com</code> / <code>DevPassw0rd!</code> — 云启 owner</div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  min-height: 100vh;
  background: #fff;
}

.aside {
  display: grid;
  place-items: center;
  padding: 48px;
  background:
    radial-gradient(1200px 600px at 10% 10%, rgba(37, 99, 235, 0.35), transparent 60%),
    linear-gradient(160deg, #0f172a 0%, #1e293b 100%);
  color: #e2e8f0;
}

.aside-inner {
  max-width: 420px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
}

.aside h1 {
  margin: 40px 0 12px;
  font-size: 30px;
  line-height: 1.3;
}

.aside p {
  margin: 0 0 24px;
  color: #94a3b8;
  line-height: 1.7;
}

.aside ul {
  margin: 0;
  padding-left: 18px;
  color: #94a3b8;
  line-height: 2;
  font-size: 13px;
}

.panel {
  display: grid;
  place-items: center;
  padding: 48px;
}

.panel-inner {
  width: 100%;
  max-width: 360px;
}

.panel h2 {
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 24px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.error {
  margin-bottom: 16px;
}

.req-id {
  margin-top: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  opacity: 0.75;
}

.submit {
  width: 100%;
}

.hint {
  margin-top: 28px;
  padding: 14px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.9;
}

.hint-title {
  margin-bottom: 4px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}

code {
  padding: 1px 4px;
  border-radius: 4px;
  background: #fff;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 900px) {
  .login-page {
    grid-template-columns: 1fr;
  }
  .aside {
    display: none;
  }
}
</style>
