# 统一响应与错误码

## 为什么要有统一信封

前端处理错误时最怕两件事：每个接口的失败结构都不一样，以及不知道失败原因是"参数错了"还是"系统挂了"。统一信封解决第一个问题，错误码解决第二个。

## 成功

```jsonc
{
  "data": { },
  "meta": {
    "requestId": "01JCF...",
    "traceId": "01JCF..."
  }
}
```

- `data` 是唯一的数据载体。不存在"有时候返回数组、有时候返回对象"。
- `meta` 只放元信息：分页游标、请求标识。业务数据一律进 `data`。
- 列表接口的 `data` 永远是数组，分页信息在 `meta`：

```jsonc
{
  "data": [ ],
  "meta": { "nextCursor": "eyJ...", "hasMore": true, "requestId": "01JCF..." }
}
```

- `204 No Content` 用于删除成功，无响应体。

## 失败

```jsonc
{
  "error": {
    "code": "TICKET_NOT_FOUND",
    "message": "工单不存在",
    "details": [
      { "field": "subject", "message": "不能为空" }
    ],
    "requestId": "01JCF..."
  }
}
```

| 字段 | 说明 |
|---|---|
| `code` | 稳定的机器可读标识。前端按它做分支，永远不改语义 |
| `message` | 给人看的中文说明。可以调整措辞，前端不得依赖 |
| `details` | 字段级错误，只在参数校验失败时出现 |
| `requestId` | 同一次请求的日志检索键。用户报障时报这个号，能直接定位 |

**HTTP 状态码与业务错误码双轨。** 状态码让网关、监控、浏览器做粗粒度判断；`code` 让业务做精确判断。只靠状态码表达业务错误，`400` 会被迫承载几十种含义。

## 错误码规范

格式：`<DOMAIN>_<REASON>`，全大写下划线分隔。新增错误码必须同时加进 `packages/shared/src/errors.ts`。

| 域 | 前缀 | 示例 |
|---|---|---|
| 通用 | `COMMON_` | `COMMON_VALIDATION_FAILED`、`COMMON_RATE_LIMITED` |
| 认证 | `AUTH_` | `AUTH_INVALID_CREDENTIALS`、`AUTH_TOKEN_EXPIRED` |
| 组织 | `ORG_` | `ORG_NOT_FOUND`、`ORG_LAST_OWNER` |
| 工单 | `TICKET_` | `TICKET_NOT_FOUND`、`TICKET_INVALID_TRANSITION` |
| 知识库 | `KB_` | `KB_ARTICLE_NOT_FOUND` |
| 模型 | `AI_` | `AI_UPSTREAM_TIMEOUT`、`AI_SCHEMA_INVALID` |

## 状态码对照

| 场景 | HTTP | code 示例 |
|---|---|---|
| 参数校验失败 | 400 | `COMMON_VALIDATION_FAILED` |
| 未登录 / 凭证无效 | 401 | `AUTH_TOKEN_EXPIRED` |
| 无权限 | 403 | `COMMON_FORBIDDEN` |
| 资源不存在 | 404 | `TICKET_NOT_FOUND` |
| 状态冲突（重复、非法流转） | 409 / 422 | `TICKET_INVALID_TRANSITION` |
| 限流 | 429 | `COMMON_RATE_LIMITED` |
| 未预期的服务端错误 | 500 | `COMMON_INTERNAL` |
| 上游依赖故障 | 502 / 504 | `AI_UPSTREAM_TIMEOUT` |

## 安全边界

- **500 的 `message` 永远是固定的"服务暂时不可用"**，真实堆栈只进日志。把堆栈返回给客户端等于免费提供攻击面信息。
- 登录失败不区分"账号不存在"与"密码错误"，统一 `AUTH_INVALID_CREDENTIALS`。
- 无权限访问他人资源的接口返回 `404` 而不是 `403`。`403` 等于确认"这个 ID 存在，只是你不能看"，是资源枚举的入口。
