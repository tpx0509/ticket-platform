import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppError, type ErrorCode, type FieldError } from '../common/error-codes';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: FieldError[];
    requestId: string;
  };
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'COMMON_VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'COMMON_UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'COMMON_FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'COMMON_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'COMMON_CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'COMMON_PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'COMMON_RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'COMMON_UNAVAILABLE',
};

/**
 * 所有异常的唯一出口。对外只暴露 code 与安全文案，
 * 堆栈只进日志 —— 把堆栈返回给客户端等于免费送出攻击面。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { status, code, message, details } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.originalUrl} -> ${status} ${code}: ${message}`);
    }

    // 探针只关心状态码和是哪个依赖挂了，不套业务信封
    if (request.path.startsWith('/health')) {
      const detail = exception instanceof HttpException ? exception.getResponse() : undefined;
      response
        .status(status)
        .json(typeof detail === 'object' && detail !== null ? detail : { status: 'error', code });
      return;
    }

    const body: ErrorBody = {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        requestId: request.requestId ?? 'unknown',
      },
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: FieldError[];
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const code = STATUS_TO_CODE[status] ?? (status >= 500 ? 'COMMON_INTERNAL' : 'COMMON_VALIDATION_FAILED');

      if (typeof payload === 'string') {
        return { status, code, message: payload };
      }
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const rawMessage = record.message;
        // 参数校验失败时 Nest 给的是字符串数组
        if (Array.isArray(rawMessage)) {
          return {
            status,
            code,
            message: '参数校验失败',
            details: rawMessage.map((item) => ({ field: '', message: String(item) })),
          };
        }
        return { status, code, message: typeof rawMessage === 'string' ? rawMessage : exception.message };
      }
      return { status, code, message: exception.message };
    }

    // 未预期异常：对外固定文案，真实原因只进日志
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'COMMON_INTERNAL',
      message: '服务暂时不可用',
    };
  }
}
