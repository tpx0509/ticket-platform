import { SetMetadata } from '@nestjs/common';

/**
 * 限流配置。挂在方法上只作用于该方法，挂在类上作用于整个 controller。
 *
 * limit 是「一个窗口内允许的次数」，windowSec 是窗口长度（秒）。
 * 不写这个装饰器的接口不限流 —— Guard 取不到元数据就直接放行。
 */
export interface RateLimitOptions {
    limit: number;
    windowSec: number;
}

export const RATE_LIMIT_KEY = 'rate-limit';

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
