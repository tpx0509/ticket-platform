<script setup lang="ts">
import { Download, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, ref, watch } from 'vue'

import { attachmentApi, saveBlob } from '@/api'
import { ApiError } from '@/api/client'
import type { Attachment } from '@/api/types'
import { formatSize, formatTime } from '@/labels'

const props = defineProps<{ orgId: string; ticketId: string }>()

const files = ref<Attachment[]>([])
const loading = ref(false)
const uploading = ref(false)
const input = ref<HTMLInputElement>()

const MAX_SIZE = 10 * 1024 * 1024

/**
 * 列表来自后端，不再是「只记本次会话上传的」。
 * 上传成功后不往数组里 unshift，而是整份重拉 —— 服务端按 createdAt 倒序，
 * 本地插队容易和它的排序打架，也测不出列表接口有没有真生效。
 */
async function load(): Promise<void> {
  if (!props.ticketId) return
  loading.value = true
  try {
    files.value = await attachmentApi.list(props.orgId, props.ticketId)
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '附件列表加载失败')
  } finally {
    loading.value = false
  }
}

async function onPick(event: Event): Promise<void> {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  // 清空 value，否则连续选同一个文件不会再触发 change
  element.value = ''
  if (!file) return

  if (file.size > MAX_SIZE) {
    ElMessage.error('文件超过 10MB，后端也会拦')
    return
  }

  uploading.value = true
  try {
    const attachment = await attachmentApi.upload(props.orgId, props.ticketId, file)
    ElMessage.success(`已上传 ${attachment.fileName}`)
    await load()
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

async function download(file: Attachment): Promise<void> {
  try {
    const { blob, fileName } = await attachmentApi.download(props.orgId, props.ticketId, file.id)
    saveBlob(blob, fileName)
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '下载失败')
  }
}

onMounted(() => {
  void load()
})

// 同一组件在两张工单之间复用（路由参数变了但组件没销毁）时也要重拉
watch(
  () => props.ticketId,
  () => {
    void load()
  },
)
</script>

<template>
  <div v-loading="loading" class="attachments">
    <div class="head">
      <span class="title">附件</span>
      <el-button size="small" :icon="UploadFilled" :loading="uploading" @click="input?.click()">
        上传
      </el-button>
      <input ref="input" type="file" hidden @change="onPick" />
    </div>

    <ul v-if="files.length" class="file-list">
      <li v-for="file in files" :key="file.id" class="file">
        <div class="file-main">
          <span class="file-name">{{ file.fileName }}</span>
          <span class="file-meta num">
            {{ formatSize(file.size) }} · {{ formatTime(file.createdAt) }}
          </span>
        </div>
        <el-button link type="primary" :icon="Download" @click="download(file)">下载</el-button>
      </li>
    </ul>

    <p v-else-if="!loading" class="empty muted">还没有附件</p>
  </div>
</template>

<style scoped>
.attachments {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-size: 14px;
  font-weight: 600;
}

.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  overflow: hidden;
}

.file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--app-border);
}

.file:last-child {
  border-bottom: none;
}

.file-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-name {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.empty {
  margin: 0;
  font-size: 13px;
}
</style>
