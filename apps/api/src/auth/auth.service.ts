import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { JwtService } from '@nestjs/jwt';

import { AppError } from '../common/error-codes';
import { ConfigService } from '../config/config.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { LoginInput, RegisterInput } from './auth.schema';

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

/** 签进 JWT 的内容。只放「识别身份」用的，不放任何敏感信息。 */
export interface JwtPayload {
  /** 用户 id。JWT 规范里 subject 就叫 sub */
  sub: string;
  email: string;
  /** 签发时间，由库自动填 */
  iat: number;
  /** 过期时间，由库自动填 */
  exp: number;
}

@Injectable()
export class AuthService {
  /**
   * 用户不存在时拿来「陪跑」的哈希，用于拉平响应时间。
   * 懒计算一次就缓存，不用每次登录都重算。
   */
  private dummyHash?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

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

  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { ...PUBLIC_USER_FIELDS, passwordHash: true },
    });

    // 关键：用户不存在时也要跑一次 argon2。
    // 否则「邮箱没注册」立刻返回、「密码错」慢几十毫秒，攻击者只靠响应时间
    // 就能把「哪些邮箱用过这个系统」一个个试出来，这叫时序侧信道。
    const storedHash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await verify(storedHash, input.password).catch(() => false);

    // 「用户不存在」和「密码错误」必须是同一个错误、同一句话。
    // 分开说等于告诉对方「这个邮箱有效」，账号可以被随便枚举。
    if (!user || !passwordOk) {
      throw new AppError('COMMON_UNAUTHORIZED', '邮箱或密码错误');
    }

    // 登录成功才更新，避免失败尝试刷写库
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const expiresIn = this.config.get('JWT_ACCESS_TTL');
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      /** 秒。前端拿它算「什么时候该续期」，不要自己猜 */
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
    };
  }

  /** 受保护路由的示例：凭 token 里的 sub 反查当前是谁 */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_FIELDS,
    });
    // token 没过期但用户已被删：当未认证处理，不能让下游拿到 undefined
    if (!user) throw new AppError('COMMON_UNAUTHORIZED', '用户不存在');
    return user;
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await hash('timing-equalizer-placeholder');
    return this.dummyHash;
  }
}
