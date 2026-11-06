import { Global, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Module } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { ConfigService } from '../../config/config.service';
import { PrismaClient } from '../../generated/prisma/client';
import type { Prisma } from '../../generated/prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConnectionRole {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly isProduction: boolean;

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
    this.isProduction = config.isProduction;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertRowLevelSecurityUsable();
    this.logger.log('数据库连接已建立');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** 供就绪探针使用：一次真实的往返，而不是看连接对象是否存在。 */
  async ping(): Promise<void> {
    await this.$queryRaw`select 1`;
  }

  /**
   * 启动自检：当前连接角色能不能被 RLS 管住。
   *
   * superuser 和带 BYPASSRLS 的角色会完全绕过行级安全，连 FORCE ROW LEVEL SECURITY
   * 都压不住。用这种角色连库，所有策略等于没写，而且不报任何错 —— 只会静默地
   * 返回别的租户的数据。这是最难被发现的一类配置错误，所以放在启动阶段拦。
   *
   * 生产抛错退出，开发只告警：本地偶尔要用 owner 连库跑迁移和排查。
   */
  private async assertRowLevelSecurityUsable(): Promise<void> {
    const [role] = await this.$queryRaw<ConnectionRole[]>`
      select rolname, rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `;
    if (!role) return;

    if (!role.rolsuper && !role.rolbypassrls) {
      this.logger.log(`数据库角色：${role.rolname}（受 RLS 约束）`);
      return;
    }

    const reason = role.rolsuper ? 'superuser' : '带 BYPASSRLS';
    const message =
      `当前数据库角色 "${role.rolname}" 是 ${reason}，行级安全策略对它不生效。` +
      '应用必须用受限角色连接（DATABASE_URL），owner 连接串只留给迁移（DATABASE_URL_MIGRATE）。';

    if (this.isProduction) {
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  /**
   * 在指定租户上下文里执行一组查询。
   *
   * 数据库那边有 RLS 策略，要求 `app.org_id` 有值才看得到行。所以凡是碰业务表的
   * 查询都必须走这里，不能直接用 this.prisma.ticket.findMany()。
   *
   * 两个关键点：
   *   1. 必须包在事务里。set local 绑定的是事务，事务一结束就失效。
   *      用 set 而不是 set local 会让设置留在连接上，连接还回池子后串租户。
   *   2. org_id 用 set_config 传参数，不拼字符串。它会被强制转 uuid，
   *      非法值直接报错，也堵死了注入。
   *
   * 这里不再 set role：DATABASE_URL 直接指向 ticket_app，连上来就是受限角色。
   * 切换身份交给连接串，代码里不做，一旦做了反而会掩盖连错库的问题。
   */
  async withTenant<T>(
    orgId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!UUID_RE.test(orgId)) {
      throw new Error(`org_id 不是合法 uuid：${orgId}`);
    }

    return this.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.org_id', ${orgId}, true)`;
      return fn(tx);
    });
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
