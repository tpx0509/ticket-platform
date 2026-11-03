/**
 * express 的 Request 类型在 express-serve-static-core 里继承全局的 Express.Request，
 * 所以增强全局命名空间才能让所有中间件和拦截器都看到这个字段。
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 由 requestContextMiddleware 写入，贯穿日志与错误响应 */
      requestId: string;
    }
  }
}

export {};
