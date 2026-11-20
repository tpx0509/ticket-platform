import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI 文档，挂在 /api-docs。
 *
 * 只在 main.ts 里调用，不进 configureApp —— 接口测试不需要 UI，
 * 少起一个路由也少一分干扰。
 *
 * 注意 addBearerAuth 只负责在页面上显示「Authorize」按钮，
 * 真要生效还得在每个受保护的路由上标 @ApiBearerAuth()。
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('工单平台 API')
    .setDescription(
      [
        '多租户工单系统。所有接口前缀 /api/v1。',
        '',
        '鉴权：先调 POST /auth/login 拿 accessToken，点右上角 Authorize 填进去。',
        '',
        '租户隔离：orgId 在路径里，后端会校验当前用户在该组织内的成员身份。',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: '登录返回的 accessToken' },
      'access-token',
    )
    .addTag('auth', '认证：注册、登录、刷新、登出')
    .addTag('tickets', '工单：列表、详情、建单')
    .addTag('attachments', '附件：上传、下载')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      // 刷新页面后保持登录态，调接口时不用反复粘贴 token
      persistAuthorization: true,
    },
  });
}
