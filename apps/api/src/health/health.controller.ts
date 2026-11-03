import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';

type CheckState = 'ok' | 'down';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 存活探针：只证明进程还在跑，不碰任何外部依赖。 */
  @Get()
  live(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /** 就绪探针：依赖不通就不接流量。 */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; uptime: number; checks: Record<string, CheckState> }> {
    const [database, cache] = await Promise.all([this.check(() => this.prisma.ping()), this.check(() => this.redis.ping())]);
    const checks = { database, cache };

    if (database === 'down' || cache === 'down') {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }
    return { status: 'ok', uptime: Math.round(process.uptime()), checks };
  }

  private async check(run: () => Promise<void>): Promise<CheckState> {
    try {
      await run();
      return 'ok';
    } catch {
      return 'down';
    }
  }
}
