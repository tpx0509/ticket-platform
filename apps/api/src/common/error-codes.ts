/**
 * 错误码是前后端的契约：前端按 code 分支，不依赖 message 措辞。
 * 新增错误码必须同步 docs/response-format.md。
 */
export const ERROR_CODES = {
  COMMON_VALIDATION_FAILED: { status: 400, message: '参数校验失败' },
  COMMON_UNAUTHORIZED: { status: 401, message: '未认证或凭证已失效' },
  COMMON_FORBIDDEN: { status: 403, message: '无权执行此操作' },
  COMMON_NOT_FOUND: { status: 404, message: '资源不存在' },
  COMMON_CONFLICT: { status: 409, message: '资源状态冲突' },
  COMMON_PAYLOAD_TOO_LARGE: { status: 413, message: '请求体超出限制' },
  COMMON_RATE_LIMITED: { status: 429, message: '请求过于频繁' },
  COMMON_INTERNAL: { status: 500, message: '服务暂时不可用' },
  COMMON_UNAVAILABLE: { status: 503, message: '依赖服务不可用' },

  // 工单域。越权访问也用它 —— 不能返回 403，否则等于确认「这个 id 存在」
  TICKET_NOT_FOUND: { status: 404, message: '工单不存在' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: FieldError[];

  constructor(code: ErrorCode, message?: string, details?: FieldError[]) {
    super(message ?? ERROR_CODES[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.details = details;
  }
}
