import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { AppError } from './error-codes';
import type { AuthedRequest } from './jwt-auth.guard';

/**
 * 取当前登录用户 id。
 *
 * 这里读的是 JwtAuthGuard 塞进 req.user 的东西，所以**必须配合 Guard 使用**。
 * 忘了挂 Guard 就会走到下面的兜底抛出 401，而不是静默拿到 undefined。
 *
 * 身份只能来自 token。绝不能让客户端用 body 或请求头自己声明「我是谁」——
 * 那等于没有鉴权。
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const userId = req.user?.sub;
    if (!userId) throw new AppError('COMMON_UNAUTHORIZED', '未登录');
    return userId;
  },
);
