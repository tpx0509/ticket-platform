import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import type { JwtPayload } from '../auth/auth.service';
import { AppError } from './error-codes';

/** 挂在 request 上的当前用户，供 handler 通过装饰器取用 */
export type AuthedRequest = Request & { user?: JwtPayload };

/**
 * 校验 Authorization: Bearer <token>。
 *
 * Guard 和中间件的区别：Guard 在路由匹配之后、handler 之前执行，
 * 能读到 handler 上的元数据（比如以后的 @Roles('admin')），
 * 中间件在路由匹配之前跑，读不到「这次要去哪个 handler」。
 * 所以「谁能调这个接口」这类判断该放 Guard。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();

    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    // 大小写不敏感：规范里是 Bearer，但客户端写 bearer 也得认
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new AppError('COMMON_UNAUTHORIZED', '缺少 Bearer token');
    }

    try {
      // verifyAsync 会同时校验签名和 exp，过期直接抛
      req.user = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      // 签名错、格式错、过期，对外统一一句话：
      // 区分「过期」和「伪造」只会给攻击者反馈，让他知道密钥猜对了一半
      throw new AppError('COMMON_UNAUTHORIZED', 'token 无效或已过期');
    }

    return true;
  }
}
