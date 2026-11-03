import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, map } from 'rxjs';

export interface SuccessEnvelope<T> {
  data: T;
  meta: { requestId: string; traceId: string };
}

/**
 * 成功响应统一包一层信封：前端只需要写一套解包逻辑。
 * 健康检查例外 —— 探针要的是裸结构，多一层反而不好判断。
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (request.path.startsWith('/health')) return next.handle();

    return next.handle().pipe(
      map((data) => {
        if (data === undefined || data === null) return data;
        return {
          data,
          meta: { requestId: request.requestId, traceId: request.requestId },
        };
      }),
    );
  }
}
