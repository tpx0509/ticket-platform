import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import { RedisService } from 'src/infra/redis/redis.service';
import { AppError } from './error-codes';
import type { AuthedRequest } from './jwt-auth.guard';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

/**
 * INCR 和 EXPIRE 必须原子。
 *
 * 分开写的话，INCR 成功、EXPIRE 还没来得及执行进程就挂了，
 * 这个 key 会变成永不过期的计数器 —— 那个用户从此被永久限死，
 * 而且不好查（TTL 是 -1，Redis 里一堆没带过期时间的 key）。
 * 用 Lua 包起来，Redis 单线程执行，中间不会插进别的命令。
 *
 * 顺带把 TTL 一起返回，少一次往返：限流拒绝时要告诉客户端等多久。
 */
const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('TTL', KEYS[1]) }
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly redis: RedisService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // 方法上的配置优先于类上的，和 RolesGuard 用的是同一套 override 语义
        const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!options) return true;

        const http = context.switchToHttp();
        const req = http.getRequest<AuthedRequest>();
        const res = http.getResponse<Response>();

        // 登录用户按 user id 算，未登录（比如登录接口本身）退化到 IP。
        // 只按 IP 会让同一个出口 NAT 后面的几十个人互相拖累。
        const identity = req.user?.sub ?? req.ip ?? 'unknown';

        // key 里必须带路由。不带的话整站共用一个计数器：
        // 刷列表刷多了，连建单都被 429 —— 这显然不对。
        const route = `${context.getClass().name}.${context.getHandler().name}`;

        // 窗口号 = 当前时间整除窗口长度。同一窗口内的请求落在同一个 key 上，
        // 窗口一过 key 自然换新的，旧 key 由 EXPIRE 清掉。
        const windowIndex = Math.floor(Date.now() / 1000 / options.windowSec);
        const key = `rl:${route}:${identity}:${windowIndex}`;

        const [count, ttl] = (await this.redis.client.eval(
            INCR_SCRIPT,
            1,
            key,
            options.windowSec,
        )) as [number, number];

        if (count > options.limit) {
            const retryAfter = ttl > 0 ? ttl : options.windowSec;
            // 429 带上 Retry-After，客户端才知道该等多久，而不是盲目重试
            res.setHeader('Retry-After', String(retryAfter));
            throw new AppError('COMMON_RATE_LIMITED', `请求过于频繁，请 ${retryAfter} 秒后再试`);
        }

        return true;
    }
}
