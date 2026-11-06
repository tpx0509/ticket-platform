import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { JsonLogger } from './common/json-logger';
import { ResponseInterceptor } from './common/response.interceptor';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './infra/prisma/prisma.service';
import { RedisModule } from './infra/redis/redis.service';
import { PingModule } from './ping/ping.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, HealthModule, PingModule, TicketsModule],
  providers: [
    JsonLogger,
    // 用 provider 注册而不是 app.useGlobalFilters()，这样过滤器也能注入依赖
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
