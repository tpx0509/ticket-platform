# 30 天清单索引

## 清单文件

`D:\desktop\全栈30天冲刺清单.html`

单文件 HTML，进度存在 `localStorage['fullstack30.v1']`。agent 改不了进度状态，只能读内容。

### 怎么取某一天的任务

清单数据在 `<script>` 里的 `WEEKS` 数组，每天一个对象：

```js
{ id:'D3', title:'进阶查询', tasks:[...], accept:'...' }
```

取某一天的完整内容：

```bash
grep -n "id:'D3'" "/d/desktop/全栈30天冲刺清单.html"
```

拿到行号后读附近几十行即可。或者直接 Read 整个文件（约 32KB，一次能读完）。

`accept` 是当天的验收标准，讲解和复盘都要以它为准——用户的原则是「验收过不了不进第二天」。

## 全 31 项标题

| ID | 周 | 标题 |
|---|---|---|
| D0 | 开局 | 开工前必须先定的两件事 |
| D1 | 第 1 周 · 数据库 | 起环境 + 建表 |
| D2 | 第 1 周 · 数据库 | 查询基础 |
| D3 | 第 1 周 · 数据库 | 进阶查询 |
| D4 | 第 1 周 · 数据库 | 索引与执行计划 |
| D5 | 第 1 周 · 数据库 | 事务与并发 |
| D6 | 第 1 周 · 数据库 | Node 连库 |
| D7 | 第 1 周 · 数据库 | 项目建模（本周大产出） |
| D8 | 第 2 周 · 接口层 | HTTP 本质 |
| D9 | 第 2 周 · 接口层 | 框架起步 |
| D10 | 第 2 周 · 接口层 | 校验与错误处理 |
| D11 | 第 2 周 · 接口层 | 鉴权（上） |
| D12 | 第 2 周 · 接口层 | 鉴权（下） |
| D13 | 第 2 周 · 接口层 | 工程细节 |
| D14 | 第 2 周 · 接口层 | 测试与文档 |
| D15 | 第 3 周 · 部署 + Agent | Docker |
| D16 | 第 3 周 · 部署 + Agent | Linux 与服务器 |
| D17 | 第 3 周 · 部署 + Agent | Nginx + HTTPS + CI/CD |
| D18 | 第 3 周 · 部署 + Agent | 运维基本功 |
| D19 | 第 3 周 · 部署 + Agent | 正式上线 + 压测 |
| D20 | 第 3 周 · 部署 + Agent | LLM API 基础 |
| D21 | 第 3 周 · 部署 + Agent | tool calling + 手写 agent loop（本周重点） |
| D22 | 第 4 周 · Agent + 面试 | RAG（上） |
| D23 | 第 4 周 · Agent + 面试 | RAG（下） |
| D24 | 第 4 周 · Agent + 面试 | MCP |
| D25 | 第 4 周 · Agent + 面试 | 接进项目 |
| D26 | 第 4 周 · Agent + 面试 | 项目收口 |
| D27 | 第 4 周 · Agent + 面试 | 八股冲刺（一） |
| D28 | 第 4 周 · Agent + 面试 | 八股冲刺（二） |
| D29 | 第 4 周 · Agent + 面试 | 投递 |
| D30 | 第 4 周 · Agent + 面试 | 复盘与迭代 |

## 两套编号不要混

仓库里出现过两套都以 D 开头的编号，含义完全不同：

| 写法 | 指什么 | 例子 |
|---|---|---|
| **D1–D30** | 学习计划的日程（本文件上半部分） | D3 = 进阶查询 |
| **项目里程碑** | ticket-platform 的建设阶段 | 骨架 → 数据层 → RLS |

项目里程碑**一律用 M 编号**，避免撞车：

| 里程碑 | 内容 | 对应学习日程 |
|---|---|---|
| M1 | monorepo 骨架、docker-compose、11 张表 ERD、接口契约、工程规范、ADR | 覆盖并超过 D1 |
| M2 | Prisma + 迁移 + 种子（数据层落地） | 覆盖 D1 建表部分、D7 项目建模 |
| M3 | Postgres RLS、受限角色、越权测试 | 清单里没有，最接近 D12 的「水平/垂直越权」 |

写进度、写记忆、跟用户对话时，只要说「D3」就必须是学习日程，说项目进度就用 M3。

## 已有进度

见 `.workbuddy/day-progress.json`。若是空的，说明这个 skill 还没被正式触发过。

参考事实（截至 2026-11-03）：

- 项目侧 M1、M2 已完成（骨架 + 数据层 + 种子数据）
- 学习侧 D1、D2 已完成（D2 的 SQL 基础用项目真实库练完，未刷 pgexercises）
- D1 里「timestamptz 与 timestamp 的区别」当时跳过了，属于面试高频，讲 D4/D5 时可以补

## 讲解时的取材

讲知识点尽量落在 ticket-platform 的真实结构上，别用玩具例子：

- 表与关系：`docs/erd.md`（organizations / users / memberships / tickets / ticket_comments / ticket_events / attachments / kb_articles / kb_chunks / ai_runs / refresh_tokens）
- 查询速查：`docs/sql-basics.md`
- 接口契约：`docs/api-v1.md`
- 响应结构：`docs/response-format.md`
- 提交与代码规范：`docs/conventions.md`
- 环境与启动：`docs/dev-setup.md`

库连接：容器 `td-postgres`，库 `ticket_dev`，用户 `ticket`。查数据用：

```bash
docker exec td-postgres psql -U ticket -d ticket_dev -c "select ...;"
```
