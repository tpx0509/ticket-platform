<script setup lang="ts">
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { ticketApi } from '@/api'
import { ApiError } from '@/api/client'
import { TICKET_PRIORITIES, TICKET_SORTS, TICKET_STATUSES } from '@/api/types'
import type { ListQuery, PageMeta, PageMode, SortOrder, TicketPriority, TicketRow, TicketSort, TicketStatus } from '@/api/types'
import TicketCreateDialog from '@/components/TicketCreateDialog.vue'
import { currentOrg } from '@/config'
import { PRIORITY_LABEL, PRIORITY_TAG, SORT_LABEL, STATUS_LABEL, STATUS_TAG, formatTime } from '@/labels'

const router = useRouter()

const rows = ref<TicketRow[]>([])
const meta = ref<PageMeta | null>(null)
const loading = ref(false)
const errorText = ref('')
const createOpen = ref(false)

const filters = reactive({
  q: '',
  status: [] as TicketStatus[],
  priority: [] as TicketPriority[],
  /** '' 不筛 | 'unassigned' 筛未分配 | uuid 筛指定人 */
  assigneeId: '',
  range: [] as string[],
  sort: 'createdAt' as TicketSort,
  order: 'desc' as SortOrder,
})

const mode = ref<PageMode>('offset')
const pageNum = ref(1)
const pageSize = ref(10)

/**
 * cursor 模式只能往后走，想回退必须自己记住走过的锚点。
 * 数组就是一条路径，index 是当前位置 —— 浏览器后退按钮的模型。
 */
const cursorPath = ref<(string | undefined)[]>([undefined])
const cursorIndex = ref(0)

function resetPaging(): void {
  pageNum.value = 1
  cursorPath.value = [undefined]
  cursorIndex.value = 0
}

async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''

  const query: ListQuery = {
    q: filters.q.trim() || undefined,
    status: filters.status.length ? filters.status : undefined,
    priority: filters.priority.length ? filters.priority : undefined,
    assigneeId: filters.assigneeId || undefined,
    // el-date-picker 用 value-format="YYYY-MM-DD"，拿到的就是后端要的纯日期
    createdFrom: filters.range[0] || undefined,
    createdTo: filters.range[1] || undefined,
    sort: filters.sort,
    order: filters.order,
    mode: mode.value,
    pageSize: pageSize.value,
  }

  if (mode.value === 'offset') {
    query.pageNum = pageNum.value
  } else {
    query.cursor = cursorPath.value[cursorIndex.value]
  }

  try {
    const result = await ticketApi.list(currentOrg.id, query)
    rows.value = result.data
    meta.value = result.meta
  } catch (error) {
    rows.value = []
    meta.value = null
    errorText.value =
      error instanceof ApiError
        ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ''}`
        : error instanceof Error
          ? error.message
          : '加载失败'
    ElMessage.error(errorText.value)
  } finally {
    loading.value = false
  }
}

/** 筛选条件改变时必须回到第一页：否则 pageNum 还停在旧位置，可能直接空空如也 */
function search(): void {
  resetPaging()
  void load()
}

function reset(): void {
  filters.q = ''
  filters.status = []
  filters.priority = []
  filters.assigneeId = ''
  filters.range = []
  filters.sort = 'createdAt'
  filters.order = 'desc'
  search()
}

function switchMode(next: PageMode): void {
  if (mode.value === next) return
  mode.value = next
  resetPaging()
  void load()
}

/** el-radio-group 的 change 只保证是 string | number | boolean，这里收窄 */
function onModeChange(value: string | number | boolean | undefined): void {
  if (value === 'offset' || value === 'cursor') switchMode(value)
}

function onPageChange(page: number): void {
  pageNum.value = page
  void load()
}

function onSizeChange(size: number): void {
  pageSize.value = size
  pageNum.value = 1
  void load()
}

function nextBatch(): void {
  const next = meta.value?.nextCursor
  if (!next) return
  cursorPath.value = cursorPath.value.slice(0, cursorIndex.value + 1)
  cursorPath.value.push(next)
  cursorIndex.value += 1
  void load()
}

function prevBatch(): void {
  if (cursorIndex.value === 0) return
  cursorIndex.value -= 1
  void load()
}

function openDetail(row: TicketRow): void {
  void router.push({ name: 'ticket-detail', params: { id: row.id } })
}

function onCreated(): void {
  resetPaging()
  void load()
}

onMounted(() => {
  void load()
})

/**
 * 在顶部切了组织，这里必须重新拉 —— 筛选条件保留着，但数据换了一批。
 * 翻页状态要一起清，否则 pageNum 还停在第 5 页，新组织只有 2 页会直接空列表。
 */
watch(
  () => currentOrg.id,
  () => {
    if (!currentOrg.id) return
    resetPaging()
    void load()
  },
)
</script>

<template>
  <div class="list-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">工单</h1>
        <p class="muted sub">
          {{ currentOrg.name }} · 共 <b>{{ meta?.total ?? '—' }}</b> 条
          <span v-if="mode === 'cursor'">（cursor 模式不数总数）</span>
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="createOpen = true">新建工单</el-button>
    </div>

    <!-- 筛选区 -->
    <div class="card filters">
      <el-input
        v-model="filters.q"
        class="f-q"
        placeholder="搜标题或描述，回车查询"
        :prefix-icon="Search"
        clearable
        @keyup.enter="search"
        @clear="search"
      />

      <el-select v-model="filters.status" multiple collapse-tags placeholder="状态" class="f-sm">
        <el-option v-for="s in TICKET_STATUSES" :key="s" :label="STATUS_LABEL[s]" :value="s" />
      </el-select>

      <el-select v-model="filters.priority" multiple collapse-tags placeholder="优先级" class="f-sm">
        <el-option v-for="p in TICKET_PRIORITIES" :key="p" :label="PRIORITY_LABEL[p]" :value="p" />
      </el-select>

      <el-select v-model="filters.sort" class="f-sort">
        <el-option v-for="s in TICKET_SORTS" :key="s" :label="`按${SORT_LABEL[s]}`" :value="s" />
      </el-select>

      <el-select v-model="filters.order" class="f-order">
        <el-option label="降序" value="desc" />
        <el-option label="升序" value="asc" />
      </el-select>

      <!-- el-date-picker 不会把外部 class 透传到根元素（实测根上是 el-date-editor，没有 f-date），
           所以外面必须套一层，否则 grid-column 加不上去 -->
      <div class="f-date">
        <el-date-picker
          v-model="filters.range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="创建起始"
          end-placeholder="创建截止"
        />
      </div>

      <el-select v-model="filters.assigneeId" placeholder="负责人" class="f-sm" clearable>
        <el-option label="全部" value="" />
        <el-option label="未分配" value="unassigned" />
      </el-select>

      <div class="f-actions">
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button :icon="Refresh" @click="reset">重置</el-button>
      </div>
    </div>

    <!-- 列表区 -->
    <div class="card table-card">
      <div class="table-head">
        <el-radio-group :model-value="mode" size="small" @change="onModeChange">          <el-radio-button value="offset">页码分页</el-radio-button>
          <el-radio-button value="cursor">游标分页</el-radio-button>
        </el-radio-group>
        <span class="muted mode-hint">
          {{
            mode === 'offset'
              ? 'offset 模式：能跳页、有总数，深翻页会越来越慢'
              : 'cursor 模式：只能前后翻、不返回总数，但翻到第 1000 页也很快'
          }}
        </span>
      </div>

      <el-alert v-if="errorText" type="error" :closable="false" class="table-error">
        {{ errorText }}
      </el-alert>

      <el-table
        v-loading="loading"
        :data="rows"
        row-key="id"
        style="width: 100%"
        @row-click="openDetail"
      >
        <el-table-column label="编号" width="90">
          <template #default="{ row }">
            <span class="num muted">#{{ row.number }}</span>
          </template>
        </el-table-column>

        <el-table-column label="标题" min-width="320">
          <template #default="{ row }">
            <span class="table-link">{{ row.subject }}</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status as TicketStatus]" effect="light" size="small">
              {{ STATUS_LABEL[row.status as TicketStatus] }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="优先级" width="100">
          <template #default="{ row }">
            <el-tag :type="PRIORITY_TAG[row.priority as TicketPriority]" effect="plain" size="small">
              {{ PRIORITY_LABEL[row.priority as TicketPriority] }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            <span class="num muted">{{ formatTime(row.createdAt) }}</span>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :image-size="80" description="没有符合条件的工单" />
        </template>
      </el-table>

      <!-- 两种分页器 -->
      <div v-if="mode === 'offset'" class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="meta?.total ?? 0"
          :current-page="pageNum"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>

      <div v-else class="pager cursor-pager">
        <span class="muted">
          第 {{ cursorIndex + 1 }} 批 · 本批 {{ rows.length }} 条
          <template v-if="meta"> · 还有下一页：{{ meta.hasNext ? '是' : '否' }}</template>
        </span>
        <el-button-group>
          <el-button size="small" :disabled="cursorIndex === 0 || loading" @click="prevBatch">上一批</el-button>
          <el-button size="small" :disabled="!meta?.hasNext || loading" @click="nextBatch">下一批</el-button>
        </el-button-group>
      </div>
    </div>

    <TicketCreateDialog v-model="createOpen" :org-id="currentOrg.id" @created="onCreated" />
  </div>
</template>

<style scoped>
.list-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.sub {
  margin: 6px 0 0;
  font-size: 13px;
}

/* 6 列网格，两行各 6 列正好排满：
   第一行 关键字(2) 状态 优先级 排序 方向
   第二行 日期(2) 负责人 按钮(3)
   元素顺序和 DOM 顺序一致，Tab 键走下来不会跳来跳去。 */
.filters {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  align-items: center;
  padding: 16px;
}

.f-q {
  grid-column: span 2;
}

.f-sm {
  grid-column: span 1;
}

/* 日期范围占 3 列。里层的 el-date-editor 自带 width: 220px 且类名拿不到，
   只能用 :deep 从外面压宽度，不然两个占位符只能显示一个。 */
.f-date {
  grid-column: span 3;
}

.f-date :deep(.el-date-editor) {
  width: 100%;
}

.f-sort,
.f-order {
  grid-column: span 1;
}

.f-actions {
  display: flex;
  grid-column: span 2;
  gap: 8px;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }

  .f-q,
  .f-date {
    grid-column: span 2;
  }

  .f-actions {
    grid-column: span 2;
    justify-content: flex-start;
  }
}

.table-card {
  padding: 4px 4px 16px;
}

.table-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 8px;
}

.mode-hint {
  font-size: 12px;
}

.table-error {
  margin: 0 16px 12px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 16px 16px 0;
}

.cursor-pager {
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
