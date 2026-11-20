import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUserId } from '../common/current-user.decorator';
import { AppError } from '../common/error-codes';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConfigService } from '../config/config.service';
import {
  REFRESH_COOKIE,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from './auth.cookie';
import {
  type LoginInput,
  type RegisterInput,
  loginSchema,
  registerSchema,
} from './auth.schema';
import { AuthService, type RequestMeta } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** POST /api/v1/auth/register —— @Post 默认 201，不用额外指定 */
  @Post('register')
  @ApiOperation({ summary: '注册', description: '返回 201；邮箱已存在返回 409' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password', 'name'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email', example: 'zhangsan@example.com' },
        password: { type: 'string', minLength: 8, maxLength: 128, example: 'secret123' },
        name: { type: 'string', minLength: 1, maxLength: 50, example: '张三' },
      },
    },
  })
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.service.register(body);
  }

  /**
   * POST /api/v1/auth/login
   *
   * @Post 默认返回 201 Created，语义是「在服务端创建了资源」。
   * 登录什么都没创建（只是换了张凭证），该是 200，所以用 @HttpCode 覆盖。
   *
   * @Res({ passthrough: true }) 是关键：不加它，Nest 会认为你要自己接管响应，
   * 后面的 return 全部作废。加了才能既写 cookie 又照常走响应拦截器。
   */
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: '登录',
    description: 'accessToken 在响应体，refreshToken 只写 httpOnly cookie，不进 body',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email', example: 'user01@example.com' },
        password: { type: 'string', example: 'DevPassw0rd!' },
      },
    },
  })
  @ApiResponse({ status: 200, description: '登录成功，响应头带 Set-Cookie' })
  @ApiResponse({ status: 401, description: '邮箱或密码错误（两种情况返回同一句话）' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.login(body, metaOf(req));
    this.setRefreshCookie(res, result.refreshToken);
    return stripRefreshToken(result);
  }

  /** POST /api/v1/auth/refresh —— 用 cookie 里的 refresh token 换新的 access */
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: '刷新 access token', description: '只读 cookie 里的 refreshToken，不需要 body' })
  @ApiResponse({ status: 200, description: '刷新成功；旧 refreshToken 立即失效（轮换）' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw new AppError('COMMON_UNAUTHORIZED', '缺少 refresh token');

    const result = await this.service.refresh(raw, metaOf(req));
    this.setRefreshCookie(res, result.refreshToken);
    return stripRefreshToken(result);
  }

  /** POST /api/v1/auth/logout —— 撤销 refresh token 并清 cookie */
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: '登出', description: '撤销 refresh token 并清 cookie，返回 204 无响应体' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.service.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions(this.config.get('COOKIE_SECURE')));
  }

  /** GET /api/v1/auth/me —— 受保护路由，不带 token 进不来 */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '当前用户', description: '拿 accessToken 换自己的基本信息' })
  @ApiResponse({ status: 401, description: '没带 token 或 token 已过期' })
  me(@CurrentUserId() userId: string) {
    return this.service.me(userId);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(
      REFRESH_COOKIE,
      token,
      refreshCookieOptions(this.config.get('JWT_REFRESH_TTL'), this.config.get('COOKIE_SECURE')),
    );
  }
}

function metaOf(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.header('user-agent') };
}

/**
 * refresh token 只走 cookie，绝不进响应体。
 * 一旦进了 body，前端很可能顺手存进 localStorage，httpOnly 就白设了。
 */
function stripRefreshToken<T extends { refreshToken: string }>(result: T): Omit<T, 'refreshToken'> {
  const { refreshToken: _ignored, ...rest } = result;
  return rest;
}
