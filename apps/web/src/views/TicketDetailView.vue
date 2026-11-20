<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ticketApi } from '@/api'
import { ApiError } from '@/api/client'
import type { TicketDetail } from '@/api/types'
import AttachmentPanel from '@/components/AttachmentPanel.vue'
import { currentOrg } from '@/config'
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
    ticket.value = await ticketApi.detail(currentOrg.id, props.id)
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
            {{ currentOrg.name }} / #{{ ticket.number }}
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
            <p v-if="ticket.description" class="desc">{{ ticket.description }}</p>
            <p v-else class="muted">建单时没填描述</p>
          </section>

          <section class="card block">
            <AttachmentPanel :org-id="currentOrg.id" :ticket-id="ticket.id" />
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

            <dt>创建人</dt>
            <dd>{{ ticket.requester.name }}</dd>

            <dt>负责人</dt>
            <!-- 没指派时后端返回 null。写「未指派」而不是留空，能区分「没人」和「没这个字段」 -->
            <dd v-if="ticket.assignee">{{ ticket.assignee.name }}</dd>
            <dd v-else class="muted">未指派</dd>

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

/* white-space: pre-wrap —— 用户填的换行要保留，不然一段多行描述会挤成一坨 */
.desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
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
