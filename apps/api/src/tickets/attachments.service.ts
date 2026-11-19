import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { AppError } from 'src/common/error-codes';
import { ConfigService } from 'src/config/config.service';
import { AttachmentsRepository } from './attachments.repository';

/**
 * 和 controller 里 FileInterceptor 的 limits.fileSize 保持一致。
 * 那个是硬拦截（超了 multer 直接中断上传，内存里不会留完整文件），
 * 这里是兜底，防止有人改了拦截器忘了改这里。
 */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/**
 * mime 是客户端自己填的，伪造成本为零，所以这份白名单只挡「手滑传错文件」，
 * 挡不住恶意文件。真正的防线是大小限制 + 不把上传目录当静态资源目录暴露，
 * 以及生产环境接一层病毒扫描。
 */
const ALLOWED_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export type UploadedAttachment = {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    checksum: string;
    createdAt: Date;
};

export type DownloadTarget = {
    absolutePath: string;
    fileName: string;
    mimeType: string;
    size: number;
};

@Injectable()
export class AttachmentsService {
    constructor(
        private readonly repo: AttachmentsRepository,
        private readonly config: ConfigService,
    ) {}

    async upload(
        orgId: string,
        ticketId: string,
        uploaderId: string,
        file: Express.Multer.File | undefined,
    ): Promise<UploadedAttachment> {
        if (!file) throw new AppError('ATTACHMENT_FILE_REQUIRED');
        if (file.size === 0) throw new AppError('ATTACHMENT_FILE_REQUIRED', '文件内容为空');
        if (file.size > MAX_UPLOAD_SIZE) throw new AppError('COMMON_PAYLOAD_TOO_LARGE', '文件超出大小限制');
        if (!ALLOWED_MIME.has(file.mimetype)) throw new AppError('ATTACHMENT_TYPE_NOT_ALLOWED');

        // 先确认工单归属，再碰磁盘。顺序反过来的话，越权请求也会在磁盘上留下垃圾文件。
        const ticket = await this.repo.findTicket(orgId, ticketId);
        if (!ticket) throw new AppError('TICKET_NOT_FOUND');

        const fileName = normaliseFileName(file.originalname);
        const checksum = createHash('sha256').update(file.buffer).digest('hex');
        const storageKey = buildStorageKey(orgId);

        // 先写盘再落库：写盘失败时库里不会留下指向空文件的记录。
        // 反过来做，落库成功而写盘失败，客户端拿到的是一个永远下载不了的附件 —— 更难收拾。
        const absolutePath = this.resolveStoragePath(storageKey);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, file.buffer);

        const row = await this.repo.create(orgId, {
            ticketId,
            uploaderId,
            fileName,
            mimeType: file.mimetype,
            // 列是 BigInt。这里必须转换 —— Prisma 的 BigInt 直接进 JSON.stringify 会抛错
            size: BigInt(file.size),
            storageKey,
            checksum,
        });

        return {
            id: row.id,
            fileName: row.fileName,
            mimeType: row.mimeType,
            size: Number(row.size),
            checksum: row.checksum,
            createdAt: row.createdAt,
        };
    }

    async prepareDownload(orgId: string, ticketId: string, id: string): Promise<DownloadTarget> {
        const row = await this.repo.findOne(orgId, ticketId, id);
        if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');

        const absolutePath = this.resolveStoragePath(row.storageKey);
        const info = await stat(absolutePath).catch(() => null);
        // 库里有、盘上没了（迁移机器、清理脚本误删），对调用方来说就是不存在
        if (!info?.isFile()) throw new AppError('ATTACHMENT_NOT_FOUND');

        return {
            absolutePath,
            fileName: row.fileName,
            mimeType: row.mimeType,
            size: info.size,
        };
    }

    /**
     * storageKey 来自数据库。数据库里的值理论上是我们自己写的，但
     * 「理论上」不能当安全边界 —— 一旦有人能写这条记录，`../../` 就能读到
     * 进程有权限读的任何文件。所以拼完必须确认没跑出存储根目录。
     */
    private resolveStoragePath(storageKey: string): string {
        const root = path.resolve(this.config.get('STORAGE_LOCAL_DIR'));
        const absolute = path.resolve(root, storageKey);
        if (absolute !== root && !absolute.startsWith(root + path.sep)) {
            throw new AppError('ATTACHMENT_NOT_FOUND');
        }
        return absolute;
    }
}

/** 按组织 + 年月分目录，单目录文件数不会无限膨胀 */
function buildStorageKey(orgId: string, now = new Date()): string {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    // 文件名用随机 uuid，不用原始文件名：重名、中文、路径穿越三个问题一次解决
    return path.posix.join(orgId, String(year), month, randomUUID());
}

/**
 * multer 收到的文件名是 latin1 解码的，中文会变成「æµ‹è¯•.pdf」。
 * 按 utf8 重新解一次；解出替换字符说明原文本来就不是 utf8，那就保留原样。
 */
function normaliseFileName(original: string): string {
    const asUtf8 = Buffer.from(original, 'latin1').toString('utf8');
    const name = asUtf8.includes('\uFFFD') ? original : asUtf8;
    // 有些浏览器会把本地路径一起塞进来（C:\fakepath\a.png），取最后一段就行
    const base = path.basename(name.replace(/\\/g, '/')).trim();
    return base.length > 0 ? base.slice(0, 200) : 'unnamed';
}
