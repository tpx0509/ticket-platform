<script setup lang="ts">
import { Download, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { ref } from 'vue'

import { attachmentApi, saveBlob } from '@/api'
import { ApiError } from '@/api/client'
import type { Attachment } from '@/api/types'
import { formatSize, formatTime } from '@/labels'

const props = defineProps<{ orgId: string; ticketId: string }>()

/** 只记录本次会话上传的，刷新后清空 —— 后端没有附件列表接口 */
const files = ref<Attachment[]>([])
const uploading = ref(false)
const input = ref<HTMLInputElement>()

const MAX_SIZE = 10 * 1024 * 1024

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
    files.value.unshift(attachment)
    ElMessage.success(`已上传 ${attachment.fileName}`)
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
</script>

<template>
  <div class="attachments">
    <div class="head">
      <span class="title">附件</span>
      <el-button size="small" :icon="UploadFilled" :loading="uploading" @click="input?.click()">
        上传
      </el-button>
      <input ref="input" type="file" hidden @change="onPick" />
    </div>

    <el-alert type="info" :closable="false" class="gap-hint">
      只列出本次会话上传的文件。后端还没有「附件列表」接口，刷新页面后历史附件看不到 ——
      这是当前接口的缺口，不是上传失败。
    </el-alert>

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

    <p v-else class="empty muted">还没有附件</p>
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

.gap-hint {
  font-size: 12px;
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
