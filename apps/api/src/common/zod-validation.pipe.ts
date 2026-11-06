import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { AppError, type FieldError } from './error-codes';

/**
 * 用 zod 校验入参。
 *
 * 为什么不用 class-validator：DTO 用 zod 定义后，类型和校验是同一份东西
 * （`z.infer`），不会出现"改了类型忘了改装饰器"。而且后面 packages/shared
 * 里的请求/响应类型也是 zod，前后端能共用同一套 schema。
 *
 * 校验失败抛 AppError，交给全局过滤器转成 400 + 字段级 details。
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    const details: FieldError[] = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw new AppError('COMMON_VALIDATION_FAILED', '参数校验失败', details);
  }
}
