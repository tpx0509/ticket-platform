import { Body, Controller, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { registerSchema, type RegisterInput } from './auth.schema';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  /** POST /api/v1/auth/register —— @Post 默认 201，不用额外指定 */
  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.service.register(body);
  }
}
