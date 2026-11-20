import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/infra/prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';

/**
 * 附件的数据访问。
 *
 * 每个方法都走 withTenant：attachments 表有 RLS 策略，不设 app.org_id
 * 的话查询会直接返回空集（而不是报错），这种「静默查不到」比报错更难查。
 */
@Injectable()
export class AttachmentsRepository {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * 上传前必须确认工单属于这个组织。
     * 不查这一步的话，A 组织的成员只要猜到 B 组织的工单 id，
     * 就能把文件挂到别人的工单上 —— 典型的水平越权。
     */
    findTicket(orgId: string, ticketId: string) {
        return this.prisma.withTenant(orgId, (tx) =>
            tx.ticket.findFirst({
                where: { id: ticketId, orgId, deletedAt: null },
                select: { id: true },
            }),
        );
    }

    create(orgId: string, data: Omit<Prisma.AttachmentUncheckedCreateInput, 'orgId'>) {
        return this.prisma.withTenant(orgId, (tx) =>
            tx.attachment.create({
                data: { ...data, orgId },
            }),
        );
    }

    /** 带上 ticketId：附件 id 对了但工单不对，同样算不存在 */
    findOne(orgId: string, ticketId: string, id: string) {
        return this.prisma.withTenant(orgId, (tx) =>
            tx.attachment.findFirst({
                where: { id, orgId, ticketId },
            }),
        );
    }

    /**
     * 列表显式列出要返回的列，而不是整行 select。
     * storageKey 是磁盘路径的一部分，属于服务端内部细节 —— 客户端拿到它
     * 只会用来猜别的文件，起不到任何作用。
     */
    findMany(orgId: string, ticketId: string) {
        return this.prisma.withTenant(orgId, (tx) =>
            tx.attachment.findMany({
                where: { orgId, ticketId },
                select: {
                    id: true,
                    fileName: true,
                    mimeType: true,
                    size: true,
                    checksum: true,
                    createdAt: true,
                },
                // 新传的排前面。附件不像工单需要稳定翻页，一次全给就够了
                orderBy: { createdAt: 'desc' },
            }),
        );
    }
}
