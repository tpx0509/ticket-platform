import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/infra/prisma/prisma.service';

/**
 * 「我属于哪些组织」。
 *
 * 这是全站唯一一个必须在没有 org_id 的前提下读业务表的地方，
 * 所以它走 withUser 而不是 withTenant —— 靠 memberships / organizations
 * 策略里的 user 分支放行（迁移 20261120120000）。
 */
@Injectable()
export class OrgsRepository {
    constructor(private readonly prisma: PrismaService) {}

    findMine(userId: string) {
        return this.prisma.withUser(userId, (tx) =>
            tx.membership.findMany({
                // status 必须筛：invited / suspended 的人不该在切换器里看到这个组织，
                // 看得见却进不去，比看不见更让人困惑
                where: { userId, status: 'active' },
                select: {
                    role: true,
                    joinedAt: true,
                    // 组织名从关系里取，省一次 join 之后的拼装
                    organization: { select: { id: true, name: true, slug: true } },
                },
                orderBy: { organization: { name: 'asc' } },
            }),
        );
    }
}
