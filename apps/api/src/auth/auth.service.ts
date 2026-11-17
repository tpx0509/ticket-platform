import { Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';

import { AppError } from '../common/error-codes';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { RegisterInput } from './auth.schema';

/**
 * 对外可见的用户字段。`passwordHash` 永远不能出现在响应里 ——
 * 一旦漏出去，等于把离线爆破的原料直接交给客户端。
 */
const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 注册。
   *
   * `users` 表没有 RLS（用户是跨组织存在的，没有单一 org_id 可用来隔离），
   * 所以这里直接走普通连接，不进 withTenant。
   */
  async register(input: RegisterInput) {
    const passwordHash = await hash(input.password);

    try {
      return await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name,
        },
        select: PUBLIC_USER_FIELDS,
      });
    } catch (error) {
      // 邮箱唯一约束冲突是业务问题，不是服务故障：必须是 409，不能落到 500
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('COMMON_CONFLICT', '邮箱已被注册');
      }
      throw error;
    }
  }
}
