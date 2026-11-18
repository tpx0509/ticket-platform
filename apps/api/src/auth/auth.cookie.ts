import type { CookieOptions } from 'express';

/**
 * refresh token 的 cookie 名。
 * 存 cookie 而不是 localStorage，唯一的理由是 httpOnly —— JS 读不到，XSS 偷不走。
 */
export const REFRESH_COOKIE = 'refresh_token';

/**
 * 只在 auth 路由下发送。别的接口（/orgs/...）请求时浏览器根本不会带上它，
 * 泄露面从「全站」缩到「两个接口」。
 */
const COOKIE_PATH = '/api/v1/auth';

export function refreshCookieOptions(maxAgeSeconds: number, secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    // 生产必须 true（只在 HTTPS 上发）；开发是 http://localhost，只能关掉
    secure,
    // Lax 挡住跨站 POST 携带 cookie 的 CSRF，同时不影响正常的顶层跳转
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: maxAgeSeconds * 1000,
  };
}

/** 清除时 path 必须和写入时一致，否则浏览器认为这是另一个 cookie，删不掉 */
export function clearRefreshCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: COOKIE_PATH,
  };
}
