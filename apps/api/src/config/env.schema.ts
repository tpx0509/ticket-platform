import { z } from 'zod';

/**
 * 环境变量是整个进程唯一的外部输入。这里校验失败就直接退出启动，
 * 而不是等运行到某个请求时才暴露 undefined。
 */

const emptyToUndefined = (value: unknown): unknown =>
  value === '' || value === null ? undefined : value;

const intFromEnv = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));

const boolFromEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  }, z.boolean());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: intFromEnv(4000, 1, 65535),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/\S+$/, '必须是 postgresql:// 连接串'),
    // 迁移用的 owner 连接串，只有 CLI 和运维脚本需要，应用进程可以不配。
    DATABASE_URL_MIGRATE: z
      .preprocess(emptyToUndefined, z.string().regex(/^postgres(ql)?:\/\/\S+$/, '必须是 postgresql:// 连接串').optional()),
    DATABASE_POOL_MAX: intFromEnv(10, 1, 100),

    REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/, '必须是 redis:// 连接串'),

    JWT_ACCESS_SECRET: z.string().min(32, '至少 32 字符，短密钥可被暴力破解'),
    JWT_REFRESH_SECRET: z.string().min(32, '至少 32 字符，短密钥可被暴力破解'),
    JWT_ACCESS_TTL: intFromEnv(900, 60),
    JWT_REFRESH_TTL: intFromEnv(604_800, 600),
    COOKIE_DOMAIN: z.string().default('localhost'),
    COOKIE_SECURE: boolFromEnv(false),

    // 允许跨域的前端地址，逗号分隔。带凭证的跨域请求不能用 '*' 通配，
    // 必须逐个列出来。默认值只覆盖本地开发，线上要显式写成真实域名。
    CORS_ORIGINS: z
      .preprocess(emptyToUndefined, z.string().default('http://localhost:5173,http://127.0.0.1:5173')),

    LLM_BASE_URL: z.string().regex(/^https?:\/\/\S+$/, '必须是 http(s) 地址'),
    LLM_API_KEY: z.string().optional(),
    LLM_CHAT_MODEL: z.string().default('deepseek-chat'),
    LLM_FAST_MODEL: z.string().default('deepseek-chat'),
    LLM_EMBED_MODEL: z.string().default('text-embedding-v3'),
    LLM_EMBED_DIM: intFromEnv(1024, 1),
    LLM_TIMEOUT_MS: intFromEnv(60_000, 1_000),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('.data/uploads'),
    UPLOAD_MAX_BYTES: intFromEnv(10 * 1024 * 1024, 1),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    // 可选：配了就同时写一份到这个文件，不配则只写 stdout。
    // 容器里由 compose 注入 /app/logs/app.log，宿主机 logrotate 切的就是它。
    LOG_FILE: z.preprocess(emptyToUndefined, z.string().optional()),
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (value[key].startsWith('dev_only')) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: '生产环境不允许使用开发期密钥',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;
