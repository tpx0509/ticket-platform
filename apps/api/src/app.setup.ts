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
  // cookie-parser 解析 Cookie 头，req.cookies 才能拿到 refresh token。
  // 不签名、不加密，只是把 "a=1; b=2" 拆成对象 —— 内容安全靠 httpOnly + 服务端校验，不靠这个中间件。
  app.use(cookieParser());
  // 必须第一个挂：后面的拦截器和控制器都依赖它写入的 requestId
  app.use(requestContextMiddleware);

  // 业务接口统一挂在 /api/v1，探针留在根路径，方便网关直接探
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
}
