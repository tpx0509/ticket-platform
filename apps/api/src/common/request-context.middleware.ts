import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { requestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 每个请求一个 requestId：外部传了就沿用（便于跨服务串联），没传就生成。
 * 它同时写进响应头和日志，用户报障时报这一个号就能定位全部日志。
 *
 * 用普通函数而不是 Nest 中间件类，是为了能用 app.use 挂在最前面 ——
 * 它必须比任何拦截器、守卫、控制器都先执行。
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  requestContext.run({ requestId }, next);
}
