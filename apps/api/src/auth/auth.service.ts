import { createHash, randomBytes } from 'node:crypto';

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

/** 写进 refresh_tokens 的设备信息，出事时用来判断是哪台机器 */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
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

  async login(input: LoginInput, meta: RequestMeta = {}) {
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

    // refresh token 的原文只经手一次：写进 cookie 后，库里只留哈希
    const refreshToken = await this.issueRefreshToken(user.id, meta);

    return {
      accessToken,
      /** 由 controller 塞进 httpOnly cookie，绝不能出现在响应体里 */
      refreshToken,
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

  /**
   * 用 refresh token 换一套新凭证。
   *
   * 这里不是「校验 JWT」，而是「校验一条数据库记录」——
   * refresh token 是不透明随机串，本身不含任何信息，状态全在库里。
   */
  async refresh(rawToken: string, meta: RequestMeta = {}) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: PUBLIC_USER_FIELDS } },
    });

    if (!record) {
      throw new AppError('COMMON_UNAUTHORIZED', '凭证无效，请重新登录');
    }

    // 已撤销的 token 再次出现，只有一种解释：有人拿着副本在用。
    // 合法客户端手上永远只有最新那一个。
    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppError('COMMON_UNAUTHORIZED', '凭证已被使用，所有会话已失效，请重新登录');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new AppError('COMMON_UNAUTHORIZED', '凭证已过期，请重新登录');
    }

    const ttlSeconds = this.config.get('JWT_REFRESH_TTL');
    const next = newRefreshToken();

    // 轮换必须原子：要么「发新的 + 作废旧的」一起成功，要么都不做。
    // 中间失败会留下两个有效 token，或者一个都不剩。
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: next.hash,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          userAgent: meta.userAgent?.slice(0, 300),
          ip: meta.ip,
        },
        select: { id: true },
      });
      await tx.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
    });

    const accessToken = await this.jwt.signAsync({
      sub: record.userId,
      email: record.user.email,
    });

    return {
      accessToken,
      refreshToken: next.raw,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL'),
      user: record.user,
    };
  }

  /**
   * 登出。只做一件事：把这条 refresh token 标记为已撤销。
   *
   * 手上的 access token 不会因此失效，它还能用最多 15 分钟。
   * 但 15 分钟后攻击者需要换新凭证，那时库里已经是 revoked 状态，换不到了。
   */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** 生成一条 refresh 记录，返回原文（给 cookie）和哈希（入库），原文只在这一个瞬间存在 */
  private async issueRefreshToken(userId: string, meta: RequestMeta): Promise<string> {
    const token = newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + this.config.get('JWT_REFRESH_TTL') * 1000),
        userAgent: meta.userAgent?.slice(0, 300),
        ip: meta.ip,
      },
    });
    return token.raw;
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

/** 32 字节随机数 → 43 字符 base64url。高熵，不需要加盐 */
function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

/**
 * 这里用普通 sha256，不像密码那样上 argon2 ——
 * 密码是低熵的人造字符串，要靠慢哈希拖住暴力破解；
 * 这个是 256 bit 随机串，枚举根本不可能，而且每次刷新都要算，慢哈希纯属自找麻烦。
 */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
