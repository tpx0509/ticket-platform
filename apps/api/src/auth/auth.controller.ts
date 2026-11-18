import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';

import { CurrentUserId } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  type LoginInput,
  type RegisterInput,
  loginSchema,
  registerSchema,
} from './auth.schema';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  /** POST /api/v1/auth/register —— @Post 默认 201，不用额外指定 */
  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.service.register(body);
  }

  /**
   * POST /api/v1/auth/login
   *
   * @Post 默认返回 201 Created，语义是「在服务端创建了资源」。
   * 登录什么都没创建（只是换了张凭证），该是 200，所以用 @HttpCode 覆盖。
   */
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.service.login(body);
  }

  /** GET /api/v1/auth/me —— 受保护路由，不带 token 进不来 */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUserId() userId: string) {
    return this.service.me(userId);
  }
}
