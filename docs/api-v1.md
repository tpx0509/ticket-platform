# 接口契约 v1

版本：v1（2026-11-02）
Base URL：`/api/v1`
状态：已定稿。类型定义落在 `packages/shared/src/contracts`，前后端引同一份。

## 全局约定

- 所有接口返回统一信封，见 [响应格式](response-format.md)。
- 所有需要登录的接口接受 `Authorization: Bearer <access_token>`。
- 所有组织内资源接口路径都带 `orgId`，服务端据此做租户隔离与权限校验。
- 写操作（`POST` / `PATCH` / `DELETE`）必须带 `Idempotency-Key` 头的情况：创建工单、上传附件。其余不要求。
- 列表接口一律游标分页，参数 `cursor` 与 `limit`（默认 20，上限 100）。
- 时间一律 ISO 8601 带时区，如 `2026-11-02T07:30:00.000Z`。

## 权限矩阵

| 角色 | 读工单 | 写工单 | 指派 | 管理成员 | 管理知识库 | 读内部备注 |
|---|---|---|---|---|---|---|
| `owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `agent` | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `viewer` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## 认证 `/auth`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册。成功后直接返回 access token 并种下 refresh cookie |
| POST | `/auth/login` | 登录 |
| POST | `/auth/refresh` | 用 cookie 中的 refresh token 换新 access token，并轮换 refresh |
| POST | `/auth/logout` | 吊销当前 refresh token，清 cookie |
| POST | `/auth/logout-all` | 吊销该用户全部 refresh token |
| GET | `/auth/me` | 当前用户信息 + 所属组织列表 |

`POST /auth/register`

```jsonc
// 请求
{ "email": "a@b.com", "password": "至少 8 位", "name": "张三" }
// 响应 201
{
  "data": {
    "user": { "id": "uuid", "email": "a@b.com", "name": "张三" },
    "accessToken": "eyJ...",
    "expiresIn": 900
  }
}
```

`POST /auth/login` 请求体同上（不含 `name`）。失败一律返回 `401 AUTH_INVALID_CREDENTIALS`，不区分"用户不存在"和"密码错误"——区分开等于提供账号枚举接口。

`GET /auth/me` 响应：

```jsonc
{
  "data": {
    "user": { "id": "uuid", "email": "a@b.com", "name": "张三" },
    "organizations": [
      { "id": "uuid", "name": "某某科技", "slug": "acme", "role": "owner" }
    ]
  }
}
```

---

## 组织 `/orgs`

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/orgs` | 登录用户 |
| POST | `/orgs` | 登录用户 |
| GET | `/orgs/:orgId` | 成员 |
| PATCH | `/orgs/:orgId` | owner / admin |
| GET | `/orgs/:orgId/members` | 成员 |
| POST | `/orgs/:orgId/members` | owner / admin |
| PATCH | `/orgs/:orgId/members/:userId` | owner / admin |
| DELETE | `/orgs/:orgId/members/:userId` | owner / admin |

`POST /orgs`：

```jsonc
{ "name": "某某科技", "slug": "acme" }
```

创建者的 membership 在同一个事务里以 `owner` 写入——组织不能出现没有归属的孤儿记录。

`POST /orgs/:orgId/members`：

```jsonc
{ "email": "b@c.com", "name": "李四", "role": "agent" }
```

若该邮箱已有账号，直接建立 membership（`status=active`）；否则创建用户并置 `status=invited`。

`PATCH /orgs/:orgId/members/:userId`：

```jsonc
{ "role": "admin" }
```

约束：不能把最后一个 `owner` 降级，返回 `409 ORG_LAST_OWNER`。

---

## 工单 `/orgs/:orgId/tickets`

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/orgs/:orgId/tickets` | 成员 |
| POST | `/orgs/:orgId/tickets` | admin / agent |
| GET | `/orgs/:orgId/tickets/:id` | 成员 |
| PATCH | `/orgs/:orgId/tickets/:id` | admin / agent |
| POST | `/orgs/:orgId/tickets/:id/status` | admin / agent |
| POST | `/orgs/:orgId/tickets/:id/assign` | admin |
| GET | `/orgs/:orgId/tickets/:id/events` | 成员 |
| GET | `/orgs/:orgId/stats` | 成员 |

`GET /orgs/:orgId/tickets` 查询参数：

| 参数 | 说明 |
|---|---|
| `status` | 逗号分隔，如 `open,pending` |
| `priority` | 同上 |
| `assigneeId` | uuid 或字面量 `me` / `unassigned` |
| `category` | |
| `q` | 关键词，走标题模糊 + 正文全文 |
| `cursor` / `limit` | 分页 |

响应：

```jsonc
{
  "data": [
    {
      "id": "uuid",
      "number": 1024,
      "subject": "导出报表报错",
      "status": "open",
      "priority": "high",
      "category": "bug",
      "requester": { "id": "uuid", "name": "张三" },
      "assignee": null,
      "commentCount": 3,
      "createdAt": "2026-11-02T07:30:00.000Z",
      "updatedAt": "2026-11-02T09:10:00.000Z"
    }
  ],
  "meta": { "nextCursor": "eyJjcmVhdGVkQXQiOi...", "hasMore": true, "requestId": "..." }
}
```

游标为 `(created_at, id)` 的 base64 编码。不用 offset：工单会持续插入，翻页时 offset 会导致重复与遗漏。

`GET /orgs/:orgId/tickets/:id` 响应：

```jsonc
{
  "data": {
    "id": "uuid",
    "number": 1,
    "subject": "API 返回 429 限流",
    "description": "完整正文",
    "status": "pending",
    "priority": "urgent",
    "category": "客户端异常",
    "source": "web",
    "requester": { "id": "uuid", "name": "许清和" },
    "assignee": { "id": "uuid", "name": "周砚" },   // 未指派为 null
    "firstResponseAt": null,
    "slaDueAt": null,
    "resolvedAt": null,
    "closedAt": null,
    "createdAt": "2026-10-23T02:02:54.063Z",
    "updatedAt": "2026-10-23T02:02:54.063Z"
  }
}
```

**以下三种情况返回完全相同的 `404 TICKET_NOT_FOUND`，不返回 403：**

1. id 从来没存在过
2. id 存在但已软删（`deleted_at` 非空）
3. id 存在但属于别的组织

403 等于确认「这个 id 存在，只是不归你」，攻击者能据此摸出别人的数据轮廓。做法是让租户条件进查询，而不是查出来之后再比较：`findFirst({ where: { id, orgId } })`，而不是 `findUnique({ where: { id } })` 再加一个 `if`。

路径里的 `orgId` 与 `id` 必须是 uuid，格式不合法直接 `400 COMMON_VALIDATION_FAILED`，不查库。

`POST /orgs/:orgId/tickets`：

```jsonc
{
  "subject": "导出报表报错",
  "description": "点击导出后 500",
  "priority": "high",
  "source": "web"
}
```

`POST /orgs/:orgId/tickets/:id/status`：

```jsonc
{ "status": "resolved", "note": "已修复，等待确认" }
```

合法流转（其余组合返回 `422 TICKET_INVALID_TRANSITION`）：

```
open      → pending | resolved | closed
pending   → open | resolved | closed
resolved  → open | closed
closed    → open
```

`GET /orgs/:orgId/stats`：

```jsonc
{
  "data": {
    "byStatus": { "open": 12, "pending": 3, "resolved": 40, "closed": 88 },
    "byPriority": { "urgent": 2, "high": 8, "normal": 30, "low": 6 },
    "opened7d": 21,
    "resolved7d": 18,
    "avgFirstResponseMinutes": 42,
    "avgResolutionMinutes": 310
  }
}
```

---

## 评论 `/orgs/:orgId/tickets/:id/comments`

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/orgs/:orgId/tickets/:id/comments` | 成员（`viewer` 不可见 `isInternal` 条目） |
| POST | `/orgs/:orgId/tickets/:id/comments` | admin / agent |

```jsonc
// 请求
{ "body": "已经定位到问题，正在修", "isInternal": true }
```

`isInternal` 的裁剪在服务端完成。前端不传该参数不代表可以是内部备注，权限不足时接口直接过滤掉。

---

## 附件 `/orgs/:orgId/attachments`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/orgs/:orgId/attachments` | `multipart/form-data`，字段 `file`、可选 `ticketId` / `commentId` |
| GET | `/orgs/:orgId/attachments/:id/download` | 返回 302 到带签名的临时地址，或直接流式返回 |

上传前服务端校验：`size <= UPLOAD_MAX_BYTES`、MIME 白名单（图片、PDF、文本、Office 文档）、文件名只作文本展示。响应返回 `id` 与 `url`，前端用它挂到工单或评论上。

---

## 知识库 `/orgs/:orgId/kb/articles`

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/orgs/:orgId/kb/articles` | 成员 |
| POST | `/orgs/:orgId/kb/articles` | admin |
| GET | `/orgs/:orgId/kb/articles/:id` | 成员 |
| PATCH | `/orgs/:orgId/kb/articles/:id` | admin |
| DELETE | `/orgs/:orgId/kb/articles/:id` | admin |
| POST | `/orgs/:orgId/kb/articles/:id/index` | admin |

`POST .../index` 投递异步任务，立即返回 `202`：

```jsonc
{ "data": { "jobId": "uuid", "status": "queued" } }
```

索引是异步的：切块 + 调用 embedding 接口是秒级到分钟级的操作，同步做会把 HTTP 连接挂死，且失败后无法重试。

---

## 模型能力 `/orgs/:orgId/ai`

| 方法 | 路径 | 说明 | 响应 |
|---|---|---|---|
| POST | `/ai/classify` | 给标题正文打分类与优先级建议 | JSON |
| POST | `/ai/suggest` | 基于知识库检索生成回复建议 | `text/event-stream` |
| POST | `/ai/ask` | 自然语言统计查询，模型自主调用工具 | `text/event-stream` |

`POST /ai/classify`

```jsonc
// 请求
{ "subject": "导出报表报错", "description": "点击导出后 500" }
// 响应
{
  "data": {
    "category": "bug",
    "priority": "high",
    "confidence": 0.87,
    "model": "deepseek-chat",
    "costMicros": 120
  }
}
```

模型输出必须过 schema 校验，字段缺失或取值越界一律视为失败，降级为"不给出建议"，不把脏数据写进工单。

`POST /ai/suggest`

```jsonc
// 请求
{ "ticketId": "uuid", "tone": "professional" }
```

SSE 事件序列：

```
event: sources
data: [{"articleId":"uuid","title":"导出失败排查","score":0.78}]

event: delta
data: {"text":"根据"}

event: delta
data: {"text":"知识库..."}

event: done
data: {"messageId":"uuid","usage":{"promptTokens":1200,"completionTokens":180}}
```

`event: sources` 先于正文发出——用户先看到依据，再看答案，信任度完全不同。前端断开连接时服务端必须中止上游请求，否则继续烧钱。

`POST /ai/ask`

```jsonc
{ "question": "这周哪个分类的工单最多" }
```

同样的 SSE 结构，中间会夹 `event: tool_call` 与 `event: tool_result`，用于前端展示"模型正在查询"，避免长时间无反馈。

---

## 健康检查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 进程存活，永远返回 200 |
| GET | `/health/ready` | 依赖可用（数据库、Redis）。任一不可用返回 503 |

两个分开：`/health` 给负载均衡判断是否需要重启进程，`/health/ready` 给流量调度判断是否该接请求。混用会导致依赖抖一下就重启整个服务。

---

## 未纳入 v1

- 工单导出（CSV / Excel）
- Webhook 与第三方集成
- 邮件通知
- 工单合并与关联
- 自定义字段
