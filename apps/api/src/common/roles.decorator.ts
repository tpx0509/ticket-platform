import { SetMetadata } from '@nestjs/common';

/**
 * 组织内的角色。数据库里 role 列是 Postgres 枚举 MemberRole，
 * 但 Prisma schema 把它映射成了 String，这里补一份可用的运行时值 + 字面量类型。
 */
export const MEMBER_ROLES = ['owner', 'admin', 'agent', 'viewer'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/** 元数据键。加前缀是为了别和第三方库用的 'roles' 撞车 */
export const ROLES_KEY = 'rbac:roles';

/**
 * 声明「这个接口允许哪些角色」。
 *
 * 只是个贴纸 —— SetMetadata 就是 Reflect.defineMetadata 的包装，
 * 真正读它的是 RolesGuard。
 *
 * 挂在方法上只对该方法生效，挂在 controller 上对全类生效，
 * 两者同时存在时方法优先（靠 Reflector.getAllAndOverride 实现）。
 */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
