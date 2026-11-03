import { Global, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Module } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { ConfigService } from '../../config/config.service';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    // Prisma 7 不再内置 Rust 引擎，连接由驱动适配器负责。
    // 连接池上限跟着 DATABASE_POOL_MAX 走，不写死在代码里。
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL'),
      max: config.get('DATABASE_POOL_MAX'),
    });
    super({
      adapter,
      log: config.isProduction ? ['error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('数据库连接已建立');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** 供就绪探针使用：一次真实的往返，而不是看连接对象是否存在。 */
  async ping(): Promise<void> {
    await this.$queryRaw`select 1`;
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
