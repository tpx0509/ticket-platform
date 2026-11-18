import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AppError } from './error-codes';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { AuthedRequest } from './jwt-auth.guard';

const uuidSchema = z.uuid();

/** 校验通过后挂在 req 上的组织身份，供 @Roles 之类的后续判断使用 */
export type OrgContext = { orgId: string; role: string };

export type OrgAuthedRequest = AuthedRequest & { orgMember?: OrgContext };

/**
 * 组织级成员校验：请求里的 :orgId 必须是当前登录用户的有效归属。
 *
 * 必须挂在 JwtAuthGuard 之后 —— 它依赖 req.user，而 req.user 是 JwtAuthGuard 塞进来的。
 * 顺序写反的表现是所有请求 403 且不报错，很难查。
 *
 * 为什么不用 return false：那会固定抛 ForbiddenException('Forbidden resource')，
 * 状态码和文案都不受控，而且只能是 403。这里要的是 404 —— 对外与「组织不存在」完全一致。
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<OrgAuthedRequest>();

    // Guard 在 Pipe 之前执行，这里拿到的是没经过 ZodValidationPipe 的原始字符串，
    // 所以 uuid 得自己验一遍。不验会一路进到 withTenant，那里 throw 的是普通 Error，
    // 全局过滤器只能落成 500。
    //
    // Express 5 的类型里 params 的值是 string | string[]（通配路由能匹配多段），
    // 这个路由只有单段，碰上数组就取第一个。
    const raw = req.params.orgId;
    const orgId = Array.isArray(raw) ? raw[0] : raw;
    if (!orgId || !uuidSchema.safeParse(orgId).success) {
      throw new AppError('COMMON_NOT_FOUND');
    }

    const userId = req.user?.sub;
    if (!userId) {
      // 正常情况下到不了这里。真到了说明 @UseGuards 里漏了 JwtAuthGuard，或者顺序反了
      throw new AppError('COMMON_UNAUTHORIZED', '未登录');
    }

    // memberships 开了 RLS，必须走 withTenant。
    // status 也要判：invited（还没接受邀请）和 suspended（被停用）都不该有权限
    const membership = await this.prisma.withTenant(orgId, (tx) =>
      tx.membership.findFirst({
        where: { orgId, userId, status: 'active' },
        select: { role: true },
      }),
    );

    if (!membership) {
      // 不是成员 → 404。返回 403 等于确认「这个组织真实存在，只是你没资格」
      throw new AppError('COMMON_NOT_FOUND');
    }

    req.orgMember = { orgId, role: membership.role };
    return true;
  }
}
