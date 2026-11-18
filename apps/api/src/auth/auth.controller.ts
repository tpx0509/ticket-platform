import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly config: ConfigService,
  ) {}

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
   *
   * @Res({ passthrough: true }) 是关键：不加它，Nest 会认为你要自己接管响应，
   * 后面的 return 全部作废。加了才能既写 cookie 又照常走响应拦截器。
   */
  @Post('login')
  @HttpCode(200)
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
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.service.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions(this.config.get('COOKIE_SECURE')));
  }

  /** GET /api/v1/auth/me —— 受保护路由，不带 token 进不来 */
  @Get('me')
  @UseGuards(JwtAuthGuard)
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
