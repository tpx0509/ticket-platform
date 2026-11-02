# ADR-0003 认证采用短效 access token + 可吊销 refresh token

日期：2026-11-02
状态：已采纳

## 背景

需要同时满足三个要求：接口鉴权不能每次都查库（性能）、用户能主动退出且立即失效（安全）、支持多设备登录并单独踢下线（产品）。

## 决策

- **access token**：JWT，HS256 签名，有效期 15 分钟，只放在内存或 `Authorization` 头，不落 localStorage。
- **refresh token**：随机 32 字节，`httpOnly` + `Secure` + `SameSite=Lax` cookie，有效期 7 天，**数据库中只存 SHA-256 哈希**，每次刷新轮换。
- 刷新时旧 token 立即吊销并记录 `replaced_by_id`。同一个旧 token 被使用第二次，判定为泄露，吊销该用户全部凭证。

## 备选方案

**A. 纯 JWT，不用 refresh。** 实现最简单。但有效期必须拉长（否则用户天天重新登录），而 JWT 一旦签发就无法撤销——用户点了"退出登录"，手里的 token 仍然有效到过期。员工离职、设备丢失时无解。

**B. 纯数据库 session。** 可随时吊销，逻辑简单。但每个请求都要查一次库，接口 QPS 上来后数据库连接会成为瓶颈。

**C. access token 存 Redis 做黑名单。** 解决了吊销问题，但每个请求多一次 Redis 往返，且 Redis 故障时全站鉴权不可用。

## 理由

1. access 短到 15 分钟，泄露窗口极小；refresh 存库可吊销，补上了 JWT 唯一的短板。
2. 99% 的请求只做本地签名校验，不碰数据库。只有刷新时才查库，频率是每 15 分钟一次而不是每请求一次。
3. refresh 轮换 + 重放检测，能发现凭证被盗用。这是单纯"存个长期 token"做不到的。
4. `httpOnly` cookie 让前端 JS 读不到 refresh token，XSS 拿不到长效凭证。access token 放内存，刷新页面后靠 cookie 静默换新。

## 后果

- 前端需要实现 401 自动刷新并重放原请求，且要防止并发请求同时触发多次刷新（用单飞/队列）。
- 跨域场景下 cookie 需要 `SameSite=None; Secure`，或前后端同域部署由 Nginx 统一入口。本项目生产环境用后者，避免第三方 cookie 限制。
- 刷新接口必须做限流，否则会成为暴力破解入口。
- 两个密钥必须不同：用同一个密钥签 refresh，等于 access 可以冒充 refresh。
- 退出登录要同时清 cookie 和吊销库中记录，只清 cookie 是假退出。
- 密码修改、角色变更等敏感操作后，应主动吊销该用户全部 refresh token。
