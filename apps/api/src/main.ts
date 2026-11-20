import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JsonLogger } from './common/json-logger';
import { ConfigService } from './config/config.service';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(JsonLogger));
  // 中间件和全局前缀都在 app.setup 里，接口测试共用同一份，避免两边配置漂移
  configureApp(app);
  // 必须在 setGlobalPrefix 之后：文档要按最终路径生成
  setupSwagger(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(
    `API 已启动：http://localhost:${port}/api/v1  文档：http://localhost:${port}/api-docs  探针：/health /health/ready`,
  );
}

bootstrap().catch((error: unknown) => {
  // 启动失败必须留下可读原因并立刻退出，不能带病运行
  process.stderr.write(`启动失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
