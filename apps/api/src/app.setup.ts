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
export function configureApp(app: INestApplication): void {
  /**
   * CORS 必须在所有中间件之前生效 —— Nest 内部会把它挂在最前面，
   * 这样浏览器的 OPTIONS 预检能直接被它接住并回 204，
   * 不用走到路由匹配那一步（不配的话预检会 404，请求全被拦）。
   *
   * credentials: true 时 origin 不能用 '*'：浏览器规定带凭证的请求
   * 必须明确知道「是哪一个源被允许」，通配符会被直接拒绝。
   * 因此这里列两个开发地址，部署时换成真实域名。
   *
   * exposedHeaders 是最容易漏的一步：跨域下 JS 默认只能读 6 个
   * 「简单响应头」，Content-Disposition（下载文件名）、
   * Idempotent-Replay（幂等重放）、Retry-After（限流）都必须显式放出来，
   * 否则代码里 res.headers.get() 拿到的是 null，且不报任何错。
   */
  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
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
