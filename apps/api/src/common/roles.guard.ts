import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError } from './error-codes';
import type { OrgAuthedRequest } from './org-member.guard';
import { ROLES_KEY, type MemberRole } from './roles.decorator';

/**
 * 角色校验：读 handler（或 controller）上 @Roles 声明的角色，
 * 和 OrgMemberGuard 查出来的 req.orgMember.role 比对。
 *
 * 必须排在 OrgMemberGuard 之后 —— 它依赖 req.orgMember。
 * 而 OrgMemberGuard 又依赖 JwtAuthGuard 写的 req.user。
 * 所以完整顺序是 JwtAuthGuard → OrgMemberGuard → RolesGuard。
 *
 * 为什么和 OrgMemberGuard 分成两个：
 * 「你是不是这个组织的人」要查库、要 404 防枚举；
 * 「你在这个组织里够不够格」是纯内存判断、要 403 让前端能提示。
 * 混一起的话，以后每加一条业务规则都要动那个查库的 guard。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // 方法上的优先，方法没声明才回退到 controller 上的。
    // 用 getAllAndOverride 而不是 get —— get 只看传入的第一个 target，读不到类上的。
    const required = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // 没挂 @Roles 就是不做角色限制。
    // 这里写成 return false 的后果：所有没声明的接口（list、detail）全部 403，
    // 而且启动时不报错，只有调接口才发现。
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<OrgAuthedRequest>();
    const role = req.orgMember?.role;

    // 正常情况下到不了这里。真到了说明 @UseGuards 里漏了 OrgMemberGuard 或顺序反了，
    // 这种情况必须拒绝而绝不能放行 —— 缺上下文时默认拒绝，是权限判断的基本纪律。
    if (!role) {
      throw new AppError('COMMON_UNAUTHORIZED', '缺少组织身份');
    }

    // role 从库里出来是 string，这里按声明的字面量集合比对
    if (!(required as readonly string[]).includes(role)) {
      throw new AppError('COMMON_FORBIDDEN', '当前角色无权执行此操作');
    }

    return true;
  }
}
