<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ticketApi } from '@/api'
import { ApiError } from '@/api/client'
import type { TicketDetail } from '@/api/types'
import AttachmentPanel from '@/components/AttachmentPanel.vue'
import { ORG } from '@/config'
import { PRIORITY_LABEL, PRIORITY_TAG, STATUS_LABEL, STATUS_TAG, formatTime } from '@/labels'

const props = defineProps<{ id: string }>()
const router = useRouter()

const ticket = ref<TicketDetail | null>(null)
const loading = ref(true)
const errorText = ref('')

async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''
  try {
    ticket.value = await ticketApi.detail(ORG.id, props.id)
  } catch (error) {
    ticket.value = null
    errorText.value =
      error instanceof ApiError
        ? error.status === 404
          ? '工单不存在，或者它不属于当前组织'
          : error.message
        : error instanceof Error
          ? error.message
          : '加载失败'
    ElMessage.error(errorText.value)
  } finally {
    loading.value = false
  }
}

function back(): void {
  void router.push({ name: 'tickets' })
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div v-loading="loading" class="detail-page">
    <el-button link :icon="ArrowLeft" class="back" @click="back">返回列表</el-button>

    <el-empty v-if="!loading && !ticket" :description="errorText || '没有这张工单'">
      <el-button @click="back">回到列表</el-button>
    </el-empty>

    <template v-else-if="ticket">
      <div class="card header">
        <div class="header-main">
          <div class="crumbs num muted">
            {{ ORG.name }} / #{{ ticket.number }}
          </div>
          <h1 class="title">{{ ticket.subject }}</h1>
          <div class="tags">
            <el-tag :type="STATUS_TAG[ticket.status]" effect="light">{{ STATUS_LABEL[ticket.status] }}</el-tag>
            <el-tag :type="PRIORITY_TAG[ticket.priority]" effect="plain">
              {{ PRIORITY_LABEL[ticket.priority] }}
            </el-tag>
          </div>
        </div>
      </div>

      <div class="grid">
        <div class="col-main">
          <section class="card block">
            <h2 class="block-title">描述</h2>
            <!-- 详情接口的 select 里没有 description，只能把缺口摆出来 -->
            <el-alert type="warning" :closable="false">
              详情接口目前只返回 编号 / 标题 / 状态 / 优先级 / 创建时间。
              描述、负责人、评论都不在返回字段里 —— 要展示得先补后端
              <code>TicketsRepository.findById</code> 的 select。
            </el-alert>
          </section>

          <section class="card block">
            <AttachmentPanel :org-id="ORG.id" :ticket-id="ticket.id" />
          </section>
        </div>

        <aside class="card block side">
          <h2 class="block-title">属性</h2>
          <dl class="props">
            <dt>编号</dt>
            <dd class="num">#{{ ticket.number }}</dd>

            <dt>状态</dt>
            <dd>{{ STATUS_LABEL[ticket.status] }}</dd>

            <dt>优先级</dt>
            <dd>{{ PRIORITY_LABEL[ticket.priority] }}</dd>

            <dt>创建时间</dt>
            <dd class="num">{{ formatTime(ticket.createdAt) }}</dd>

            <dt>工单 ID</dt>
            <dd class="mono">{{ ticket.id }}</dd>
          </dl>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 320px;
}

.back {
  align-self: flex-start;
  padding-left: 0;
}

.header {
  padding: 20px 24px;
}

.crumbs {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.title {
  margin: 8px 0 12px;
  font-size: 22px;
  line-height: 1.4;
}

.tags {
  display: flex;
  gap: 8px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.col-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.block {
  padding: 20px 24px;
}

.block-title {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 600;
}

.props {
  display: grid;
  grid-template-columns: 84px 1fr;
  gap: 10px 12px;
  margin: 0;
  font-size: 13px;
}

.props dt {
  color: var(--el-text-color-secondary);
}

.props dd {
  margin: 0;
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
