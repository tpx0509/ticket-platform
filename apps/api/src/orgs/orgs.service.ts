import { Injectable } from '@nestjs/common';

import { OrgsRepository } from './orgs.repository';

/** 拍平后的组织视图：前端只关心「id 用来拼路径、name 用来显示、role 用来挡按钮」 */
export type OrgView = {
    id: string;
    name: string;
    slug: string;
    role: string;
    joinedAt: Date | null;
};

@Injectable()
export class OrgsService {
    constructor(private readonly repo: OrgsRepository) {}

    async mine(userId: string): Promise<OrgView[]> {
        const rows = await this.repo.findMine(userId);

        // 不把 membership 原样扔给前端：里面有 orgId / userId 两份冗余，
        // 前端还得自己想「哪个字段才是组织 id」
        return rows.map((row) => ({
            id: row.organization.id,
            name: row.organization.name,
            slug: row.organization.slug,
            role: row.role,
            joinedAt: row.joinedAt,
        }));
    }
}
