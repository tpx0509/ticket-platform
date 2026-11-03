import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger';
import { requestContextMiddleware } from './common/request-context.middleware';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(JsonLogger));
  // 必须第一个挂：后面的拦截器和控制器都依赖它写入的 requestId
  app.use(requestContextMiddleware);

  // 业务接口统一挂在 /api/v1，探针留在根路径，方便网关直接探
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`API 已启动：http://localhost:${port}/api/v1  探针：/health /health/ready`);
}

bootstrap().catch((error: unknown) => {
  // 启动失败必须留下可读原因并立刻退出，不能带病运行
  process.stderr.write(`启动失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
