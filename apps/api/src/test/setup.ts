/**
 * 接口测试的环境准备。
 *
 * 在 vitest 的 setupFiles 里执行，早于任何测试文件的 import ——
 * 这一点很关键：AppModule 一被 import 就会读环境变量，
 * 等进了 beforeAll 再改就晚了。
 *
 * 三条隔离：
 *   1. 库换成 ticket_test，不碰 ticket_dev 里攒的开发数据
 *   2. Redis 换到 15 号库，否则限流计数会和本地跑着的 4800 互相污染
 *   3. 日志压到 error，测试输出里不该混一堆 JSON 日志
 */
import { loadEnv } from '../config/load-env';

loadEnv();

/** ticket_dev → ticket_test，其余参数（schema、连接池大小）原样保留 */
function toTestDatabase(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace('/ticket_dev?', '/ticket_test?');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = toTestDatabase(process.env.DATABASE_URL);
process.env.DATABASE_URL_MIGRATE = toTestDatabase(process.env.DATABASE_URL_MIGRATE);

// redis://host:port/<db> 只换最后那段数字
process.env.REDIS_URL = (process.env.REDIS_URL ?? '').replace(/\/\d+$/, '/15');
process.env.LOG_LEVEL = 'error';

if (!process.env.DATABASE_URL?.includes('ticket_test')) {
  throw new Error('测试库没切成功，DATABASE_URL 里看不到 ticket_test，先确认根目录 .env 存在');
}
