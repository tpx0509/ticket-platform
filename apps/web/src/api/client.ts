/**
 * 所有请求的唯一出口。
 *
 * 后端两个信封必须在这里解开，页面才拿得到裸数据：
 *   成功：{ data, meta: { requestId, traceId } }
 *   失败：{ error: { code, message, details?, requestId } }
 *
 * 401 会先尝试刷新一次再重放，并且多个并发请求只发一次刷新 ——
 * 否则页面一进来同时打三个接口，就会连着调三次 /auth/refresh，
 * 而 refresh token 是轮换的，第二次必然用旧的、直接失败。
 */

/**
 * 接口基址的取值顺序：环境变量 > 生产构建默认 > 开发默认。
 *
 * 生产用相对路径 `/api/v1`，和页面同源 —— 浏览器不做跨域预检，
 * refresh_token 那个 SameSite=Lax 的 cookie 才能正常带上。
 * 这里写死默认值而不是只靠构建命令传 VITE_API_BASE：
 * 少传一次环境变量，线上包就会退回 localhost:4800，页面直接白屏。
 */
const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.PROD ? '/api/v1' : 'http://localhost:4800/api/v1')

/**
 * 开发期最容易踩的一个坑，提前喊一声。
 *
 * refresh_token 是 SameSite=Lax 的 cookie，跨站请求根本不会带上它。
 * 而 127.0.0.1 和 localhost 在浏览器眼里是两个不同的站（端口不影响）。
 * 所以页面开 127.0.0.1:5173、接口又是 localhost:4800 时：
 * 登录能成（Set-Cookie 里写的是 localhost），但 access 一过期就换不了签，
 * 表现为「刷新页面直接跳登录」，光看代码完全猜不到。
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // 第二个参数 base 不能省：线上 VITE_API_BASE 是相对路径 `/api/v1`，
  // 单参数的 new URL('/api/v1') 会抛 Invalid URL，整页白屏。
  const apiHost = new URL(BASE, window.location.origin).hostname
  if (apiHost !== window.location.hostname) {
    console.warn(
      `[auth] 页面域名是 ${window.location.hostname}，接口域名是 ${apiHost}，两者不是同一个站点，` +
        `SameSite=Lax 的 refresh_token 不会随请求发出，token 过期后会被踢回登录页。` +
        `开发时请统一用 http://localhost:5173 打开。`,
    )
  }
}

/** accessToken 存在 localStorage：刷新页面不丢。refreshToken 在 httpOnly cookie 里，JS 碰不到。 */
const TOKEN_KEY = 'ticket.accessToken'

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
}

export interface FieldError {
  field: string
  message: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
    readonly requestId = '',
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** 把 details 拼成一行，表单下方直接用 */
  get fieldMessage(): string {
    return this.details.map((item) => (item.field ? `${item.field}: ${item.message}` : item.message)).join('；')
  }
}

export interface ApiEnvelope<T> {
  data: T
  meta: { requestId: string; traceId: string }
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: FieldError[]; requestId?: string }
}

export type Query = Record<string, string | number | boolean | string[] | null | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Query
  body?: unknown
  form?: FormData
  /** 额外请求头。幂等键走这里：Idempotency-Key 属于传输层，不该混进 body */
  headers?: Record<string, string>
  /** 默认 true。登录/刷新这类接口要显式关掉，否则 401 会触发刷新死循环 */
  auth?: boolean
}

function buildUrl(path: string, query?: Query): string {
  // 第二个参数不能省：生产环境 BASE 是相对路径 `/api/v1`，
  // 单参数的 new URL('/api/v1/tickets') 会抛 "Failed to construct 'URL': Invalid URL"，
  // 表现为点登录后页面顶部弹红条、请求根本没发出去。
  const url = new URL(BASE + path, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      // 数组要重复同名参数：status=open&status=pending，后端 zod 才收得到多值
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item)
      } else {
        url.searchParams.append(key, String(value))
      }
    }
  }
  return url.toString()
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    // 不是 JSON —— 多半是打到了不存在的路由拿到 Express 的 HTML 404 页
  }
  return new ApiError(
    res.status,
    body?.error.code ?? 'NETWORK_ERROR',
    body?.error.message ?? `请求失败（HTTP ${res.status}）`,
    body?.error.details ?? [],
    body?.error.requestId ?? res.headers.get('x-request-id') ?? '',
  )
}

/** 单飞锁：并发 401 时只真正刷新一次，其余请求排队等同一个 promise */
let refreshing: Promise<string | null> | null = null

/**
 * accessToken 和 refreshToken 都失效了。
 *
 * 页面里没有任何一处会「主动发现自己该跳登录」—— 路由守卫只在导航时跑，
 * 用户停在列表页刷一下数据就 401 了，守卫根本不会触发。
 * 所以只能在这里硬跳，并把当前地址带上，登录完能回来。
 */
function forceLogin(): void {
  tokenStore.clear()
  if (typeof window === 'undefined') return
  if (window.location.pathname.startsWith('/login')) return
  const redirect = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.replace(`/login?redirect=${redirect}`)
}

async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) return null
      const payload = (await res.json()) as ApiEnvelope<{ accessToken: string }>
      tokenStore.set(payload.data.accessToken)
      return payload.data.accessToken
    } catch {
      return null
    } finally {
      // 无论成败都放开锁，下次 401 还能再试
      setTimeout(() => {
        refreshing = null
      }, 0)
    }
  })()

  return refreshing
}

async function send<T>(path: string, options: RequestOptions = {}, allowRetry = true): Promise<T> {
  const { method = 'GET', query, body, form, headers: extra, auth = true } = options

  const headers: Record<string, string> = { ...extra }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = tokenStore.get()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  // 上传时不要手动设 Content-Type：浏览器要自己带 boundary，手设了后端就解析不出文件

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    credentials: 'include',
  })

  if (res.status === 401 && auth && allowRetry) {
    const fresh = await refreshAccessToken()
    if (fresh) return send<T>(path, options, false)
    forceLogin()
    throw await toApiError(res)
  }

  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T

  const payload = (await res.json()) as ApiEnvelope<T>
  return payload.data
}

/** 需要完整信封时用（比如列表要 meta.total 算分页） */
async function sendWithMeta<T>(path: string, options: RequestOptions): Promise<ApiEnvelope<T>> {
  const { method = 'GET', query, body, form, headers: extra } = options
  const headers: Record<string, string> = { ...extra }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    credentials: 'include',
  })

  if (res.status === 401) {
    const fresh = await refreshAccessToken()
    if (fresh) return sendWithMeta<T>(path, options)
    forceLogin()
    throw await toApiError(res)
  }
  if (!res.ok) throw await toApiError(res)

  return (await res.json()) as ApiEnvelope<T>
}

/**
 * 下载二进制流。
 *
 * 不能用 send()：它一律 res.json()，对二进制直接抛解析错。
 * 文件名从 Content-Disposition 里取 —— 后端用的是 RFC 5987 的
 * filename*=UTF-8''%E6%B5%8B%E8%AF%95.txt 形式，中文名才不会乱码。
 */
export async function downloadFile(path: string): Promise<{ blob: Blob; fileName: string }> {
  const token = tokenStore.get()
  const res = await fetch(buildUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (res.status === 401) {
    const fresh = await refreshAccessToken()
    if (fresh) return downloadFile(path)
    forceLogin()
    throw await toApiError(res)
  }
  if (!res.ok) throw await toApiError(res)

  const disposition = res.headers.get('content-disposition') ?? ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1]
  const fileName = encoded ? decodeURIComponent(encoded) : (plain ?? 'download')

  return { blob: await res.blob(), fileName }
}

export const http = { send, sendWithMeta, buildUrl, BASE }
