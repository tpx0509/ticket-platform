<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { reactive, ref, watch } from 'vue'

import { ticketApi } from '@/api'
import { ApiError } from '@/api/client'
import { TICKET_PRIORITIES } from '@/api/types'
import type { CreateTicketBody, TicketDetail } from '@/api/types'
import { PRIORITY_LABEL } from '@/labels'

const props = defineProps<{ orgId: string }>()
const emit = defineEmits<{ created: [ticket: TicketDetail] }>()

const visible = defineModel<boolean>({ required: true })

const formRef = ref<FormInstance>()
const submitting = ref(false)
const errorText = ref('')
const idempotencyKey = ref('')

const form = reactive<CreateTicketBody>({
  subject: '',
  description: '',
  priority: 'normal',
})

const rules: FormRules = {
  subject: [
    { required: true, message: '标题不能为空', trigger: 'blur' },
    { max: 200, message: '不超过 200 字', trigger: 'blur' },
  ],
  description: [{ required: true, message: '描述不能为空', trigger: 'blur' }],
}

/**
 * 幂等键在「打开弹窗」这一刻生成，整次提交过程都用它。
 *
 * 如果放在 submit() 里生成，用户点两次就是两个新 key，
 * 后端会老老实实建两张单 —— 幂等等于没做。
 * 关闭弹窗后下次打开重新生成，那是另一个逻辑请求了。
 */
watch(visible, (open) => {
  if (!open) return
  form.subject = ''
  form.description = ''
  form.priority = 'normal'
  errorText.value = ''
  formRef.value?.clearValidate()
  idempotencyKey.value = crypto.randomUUID()
})

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  errorText.value = ''

  try {
    const ticket = await ticketApi.create(
      props.orgId,
      {
        subject: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
      },
      idempotencyKey.value,
    )
    ElMessage.success(`已创建工单 #${ticket.number}`)
    emit('created', ticket)
    visible.value = false
  } catch (error) {
    if (error instanceof ApiError) {
      // 403 是角色不够，后端文案是「无权访问」，这里换成用户能懂的说法
      errorText.value =
        error.status === 403
          ? '当前角色不能建单（viewer 只读），换 owner / admin / agent 账号试试'
          : error.fieldMessage || error.message
    } else {
      errorText.value = error instanceof Error ? error.message : '创建失败'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="新建工单" width="560px" :close-on-click-modal="false">
    <el-alert v-if="errorText" type="error" :closable="false" class="dialog-error">
      {{ errorText }}
    </el-alert>

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="标题" prop="subject">
        <el-input v-model="form.subject" maxlength="200" show-word-limit placeholder="一句话说清问题" />
      </el-form-item>

      <el-form-item label="描述" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="5"
          maxlength="5000"
          show-word-limit
          placeholder="复现步骤、期望结果、实际结果"
        />
      </el-form-item>

      <el-form-item label="优先级">
        <el-radio-group v-model="form.priority">
          <el-radio-button v-for="p in TICKET_PRIORITIES" :key="p" :value="p">
            {{ PRIORITY_LABEL[p] }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <div class="idem">
      <span class="idem-label">Idempotency-Key</span>
      <code>{{ idempotencyKey }}</code>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">创建</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-error {
  margin-bottom: 16px;
}

.idem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.idem-label {
  flex: none;
  font-weight: 500;
}

.idem code {
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
