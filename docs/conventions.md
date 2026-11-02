# 工程规范

## 提交信息

Conventional Commits，中文描述，说清改了什么。

```
<type>(<scope>): <描述>

[可选正文：为什么这么改]
```

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修缺陷 |
| `refactor` | 不改行为的重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `docs` | 文档 |
| `chore` | 构建、依赖、配置 |
| `ci` | 流水线 |
| `db` | 迁移脚本 |

`scope` 取值：`api`、`web`、`worker`、`shared`、`infra`、`docs`。

正例：

```
feat(api): 工单状态流转加入合法性校验

非法流转原先会直接写入，导致 closed 的工单能被改回 pending。
现在在 service 层按状态机拦截，返回 422 TICKET_INVALID_TRANSITION。
```

反例：`update`、`fix bug`、`修改`。

## 分支

- `main` 始终可部署。任何提交进 `main` 前 CI 必须绿。
- 功能分支 `feat/<简述>`，修复分支 `fix/<简述>`，合并后删除。
- 提交粒度按"一个可描述的变化"，不按文件数。一次提交里同时改接口和改页面样式，说明该拆。

## 代码

- 目录按职责分层，不按技术类型。`tickets/` 下包含 controller、service、repository、dto，而不是顶层放 `controllers/`、`services/`。
- 命名：文件 `kebab-case`，类 `PascalCase`，函数与变量 `camelCase`，常量 `SCREAMING_SNAKE_CASE`，数据库 `snake_case`。
- 任何函数不超过 40 行。超了说明它做了不止一件事。
- 不写注释解释"是什么"，只写"为什么"。代码能表达是什么，表达不了的是取舍理由。
- 禁止 `any`。确实未知时用 `unknown` 并在边界处收窄。
- 禁止在业务代码里读 `process.env`，统一从配置模块取。这样配置才有唯一的校验入口。

## 数据库

- 结构变更只有一条路：改 `schema.prisma` → 生成迁移 → 提交迁移文件。不允许手工在数据库里执行 DDL。
- 迁移文件一旦合并进 `main` 就不再修改。改错了就再加一个迁移改回来。
- 每个新表必须显式声明索引，尤其是外键列和列表页的查询列。外键不会自动建索引。
- 查询必须带 `org_id`。这是多租户隔离的底线，代码评审的第一检查项。

## 接口

- 先写进 `docs/api-v1.md`，再实现。
- 请求与响应类型定义在 `packages/shared`，前端 import 同一份。后端改字段，前端编译期就报错。
- 所有入参必须校验，校验失败返回 400 + 字段级 `details`。不信任任何来自客户端的数据。

## 密钥与环境

- 代码里不出现连接串、密钥、token。全部走 `.env`。
- `.env` 不进版本库，`.env.example` 进，且字段齐全、有说明。
- 生产环境密钥不落在仓库和镜像里，由部署机注入。
- 发现密钥误提交：立即轮换密钥，再清理历史。只删 commit 不够，历史里还在。

## 日志

- 结构化日志，字段固定：`level`、`time`、`requestId`、`orgId`、`userId`、`msg`、`durationMs`。
- 不打印完整请求体，不打印密码、token、身份证、手机号。
- 错误日志必须带堆栈。吞掉错误只打一句"出错了"，等于没打。
