import { Injectable, type LoggerService } from '@nestjs/common';

import { requestContext } from '../common/request-context';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * 单行 JSON 输出。字段固定，便于日志系统按字段建索引与告警。
 * 不打印请求体与任何凭证 —— 日志一旦写了密钥，等于泄露。
 */
@Injectable()
export class JsonLogger implements LoggerService {
  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const store = requestContext.getStore();
    const line: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
    };
    if (context) line.context = context;
    if (store?.requestId) line.requestId = store.requestId;
    if (store?.orgId) line.orgId = store.orgId;
    if (store?.userId) line.userId = store.userId;
    if (extra) Object.assign(line, extra);
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack ? { stack } : undefined);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }
}
