import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  orgId?: string;
  userId?: string;
}

/**
 * 请求级上下文。日志从任何深度取 requestId，不需要层层传参。
 * 这也让后续的审计、慢查询归因有统一的关联键。
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
