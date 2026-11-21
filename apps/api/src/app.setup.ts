import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';

import { requestContextMiddleware } from './common/request-context.middleware';

/**
 * 应用装配。main.ts 和接口测试共用这一份。
 *
 * 为什么必须抽出来：这些中间件和全局前缀写在 main.ts 里，
 * 测试用 Test.createTestingModule 起的应用不会执行 main.ts，
 * 结果就是「线上 401、测试 404」—— 因为测试里的路由没挂 /api/v1 前缀。
 * 两边调同一个函数，才不会各配各的。
 */
export interface AppSetupOptions {
  /**
   * 允许跨域的前端地址。由调用方从环境变量解析后传进来，
   * 不传时用本地开发默认值（接口测试跑的就是这个场景）。
   */
  corsOrigins?: string[];
}

const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function configureApp(app: INestApplication, options: AppSetupOptions = {}): void {
  /**
   * 反向代理支持。Express 默认把 TCP 直连的地址当作客户端 IP，
   * 部署到 Nginx 后面之后，每个请求都来自 127.0.0.1 —— 后果是
   * rate-limit.guard.ts 把所有用户算成同一个人（共用一个限流桶），
   * 登录日志里记录的 IP 也全是本机，出事时无法追溯。
   *
   * 必须设成数字 1（只信任最近一跳），不能设 true：
   * true 表示信任整条 X-Forwarded-For 链，客户端可以自己伪造这个头、
   * 声称自己是任意 IP，按 IP 限流就形同虚设。
   */
  const express = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
  express.set?.('trust proxy', 1);

  /**
   * CORS 必须在所有中间件之前生效 —— Nest 内部会把它挂在最前面，
   * 这样浏览器的 OPTIONS 预检能直接被它接住并回 204，
   * 不用走到路由匹配那一步（不配的话预检会 404，请求全被拦）。
   *
   * credentials: true 时 origin 不能用 '*'：浏览器规定带凭证的请求
   * 必须明确知道「是哪一个源被允许」，通配符会被直接拒绝。
   * 所以地址从环境变量 CORS_ORIGINS 读：本地是 5173，线上是真实域名。
   *
   * exposedHeaders 是最容易漏的一步：跨域下 JS 默认只能读 6 个
   * 「简单响应头」，Content-Disposition（下载文件名）、
   * Idempotent-Replay（幂等重放）、Retry-After（限流）都必须显式放出来，
   * 否则代码里 res.headers.get() 拿到的是 null，且不报任何错。
   */
  app.enableCors({
    origin: options.corsOrigins ?? DEFAULT_CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // 自定义头会触发预检，不在这个列表里的头会让整个请求失败
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['Content-Disposition', 'Idempotent-Replay', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });

  // cookie-parser 解析 Cookie 头，req.cookies 才能拿到 refresh token。
  // 不签名、不加密，只是把 "a=1; b=2" 拆成对象 —— 内容安全靠 httpOnly + 服务端校验，不靠这个中间件。
  app.use(cookieParser());
  // 必须第一个挂：后面的拦截器和控制器都依赖它写入的 requestId
  app.use(requestContextMiddleware);

  // 业务接口统一挂在 /api/v1，探针留在根路径，方便网关直接探
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
}
