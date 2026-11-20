import {
    Controller,
    Get,
    Param,
    Post,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiOperation,
    ApiParam,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentUserId } from 'src/common/current-user.decorator';
import { JwtAuthGuard } from 'src/common/jwt-auth.guard';
import { OrgMemberGuard } from 'src/common/org-member.guard';
import { Roles } from 'src/common/roles.decorator';
import { RolesGuard } from 'src/common/roles.guard';
import { ZodValidationPipe } from 'src/common/zod-validation.pipe';
import { AttachmentsService, MAX_UPLOAD_SIZE } from './attachments.service';

/**
 * 附件挂在工单下面，路由就跟着工单走：orgs/:orgId/tickets/:ticketId/attachments。
 * orgId 在 URL 里不是多余的 —— OrgMemberGuard 靠它判断「你是不是这个组织的人」。
 */
@ApiTags('attachments')
@ApiBearerAuth('access-token')
@ApiParam({ name: 'orgId', description: '组织 id', format: 'uuid' })
@ApiParam({ name: 'ticketId', description: '工单 id', format: 'uuid' })
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@Controller('orgs/:orgId/tickets/:ticketId/attachments')
export class AttachmentsController {
    constructor(private readonly service: AttachmentsService) {}

    /**
     * FileInterceptor 的 'file' 必须和前端 FormData 里的字段名完全一致，
     * 不一致的表现是 file 为 undefined、接口报「未收到文件」，而不是报错说字段名错了。
     *
     * limits 在解析阶段生效：超过 10MB 时 multer 立刻中止，不会把整个文件读进内存。
     * 这是上传接口唯一有效的内存保护，别指望 service 里再判断大小 —— 那时候已经晚了。
     */
    @Post()
    @Roles('owner', 'admin', 'agent')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE } }))
    @ApiOperation({ summary: '上传附件', description: 'multipart/form-data，字段名必须是 file' })
    // 不带这两个装饰器，Swagger UI 会按 JSON 发请求，multipart 接口在页面上永远调不通
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file'],
            properties: {
                file: { type: 'string', format: 'binary', description: '最大 10MB' },
            },
        },
    })
    @ApiResponse({ status: 201, description: '上传成功，返回附件记录' })
    @ApiResponse({ status: 413, description: '文件超过 10MB' })
    upload(
        @Param('orgId', new ZodValidationPipe(z.uuid())) orgId: string,
        @Param('ticketId', new ZodValidationPipe(z.uuid())) ticketId: string,
        @UploadedFile() file: Express.Multer.File | undefined,
        @CurrentUserId() userId: string,
    ) {
        return this.service.upload(orgId, ticketId, userId, file);
    }

    /**
     * 这里用 @Res() 全手动写响应，而不是 @Res({ passthrough: true }) + StreamableFile。
     * 因为全局 ResponseInterceptor 会把返回值包成 { data, meta } —— 二进制流被包进去就废了。
     * 用 @Res() 之后 Nest 不再自动发送响应，所以下面必须自己 pipe。
     */
    @Get(':id/download')
    @ApiOperation({ summary: '下载附件', description: '返回二进制流，Content-Disposition 带 UTF-8 文件名' })
    @ApiParam({ name: 'id', description: '附件 id', format: 'uuid' })
    @ApiResponse({ status: 200, description: '文件流' })
    @ApiResponse({ status: 404, description: '附件不存在，或不属于这张工单 / 这个组织' })
    async download(
        @Param('orgId', new ZodValidationPipe(z.uuid())) orgId: string,
        @Param('ticketId', new ZodValidationPipe(z.uuid())) ticketId: string,
        @Param('id', new ZodValidationPipe(z.uuid())) id: string,
        @Res() res: Response,
    ): Promise<void> {
        const target = await this.service.prepareDownload(orgId, ticketId, id);

        res.setHeader('Content-Type', target.mimeType);
        res.setHeader('Content-Length', String(target.size));
        res.setHeader('Content-Disposition', contentDisposition(target.fileName));
        // 不让浏览器猜类型：上传的是 html 也不会被当成页面执行
        res.setHeader('X-Content-Type-Options', 'nosniff');

        const stream = createReadStream(target.absolutePath);
        stream.on('error', () => {
            // 响应头已经发出去了，改不了状态码，只能断开连接让客户端知道传输失败
            res.destroy();
        });
        stream.pipe(res);
    }
}

/**
 * 中文文件名不能直接塞进 filename="..."：那是 latin1 的，中文会被截成乱码。
 * RFC 5987 的 filename*=UTF-8''... 才是给非 ASCII 用的，
 * 但老客户端只认 filename，所以两个都给：ASCII 兜底 + UTF-8 正式值。
 */
function contentDisposition(fileName: string): string {
    const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
