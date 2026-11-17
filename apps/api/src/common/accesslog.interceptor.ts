import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import type { Request } from 'express';
import { finalize } from "rxjs";

@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const started = Date.now();
    return next.handle().pipe(
      finalize(() => this.logger.log(`${req.method} ${req.originalUrl} ${Date.now() - started}ms`)),
    );
  }
}
