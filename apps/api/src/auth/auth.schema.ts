import { z } from 'zod';

/**
 * 注册入参。
 *
 * `.strict()` 是必须的：不加的话客户端可以塞 `id`、`passwordHash`、`emailVerifiedAt`
 * 这类字段，Prisma 会照单全收 —— 等于把建用户接口变成"随便写任意列"。
 */
export const registerSchema = z
  .object({
    email: z.email('邮箱格式不正确'),
    // 上限只是兜底，argon2 不像 bcrypt 有 72 字节截断问题
    password: z.string().min(8, '密码至少 8 位').max(128, '密码过长'),
    name: z.string().min(1, '名字不能为空').max(50, '名字过长'),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
