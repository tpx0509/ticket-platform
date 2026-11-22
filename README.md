# TicketDesk

面向中小团队的服务工单平台。客户提交请求，团队成员分类、指派、处理、回复；系统负责记录全过程，并用模型完成自动分类与回复建议。

## 产品边界

**做什么**

- 多组织（租户）隔离，一个用户可以属于多个组织
- 工单全生命周期：创建 → 分类 → 指派 → 处理 → 解决 → 关闭
- 评论与内部备注分离（内部备注不对客户可见）
- 附件上传与下载
- 知识库文章，作为回复建议的检索来源
- 模型能力：工单自动分类、基于知识库的回复建议、自然语言统计查询
- 全链路审计：每一次状态变更、指派、评论都留痕

**不做什么**

- 计费与订阅
- 邮件 / IM 通知（留接口位，不实现）
- 多语言
- 移动端

## 架构

```mermaid
flowchart LR
  U[浏览器] -->|HTTPS| N[Nginx]
  N -->|/| W[web · Next.js]
  N -->|/api| A[api · NestJS]
  A --> P[(PostgreSQL 16 + pgvector)]
  A --> R[(Redis)]
  A -->|入队| R
  W -->|服务端内部请求| A
  K[worker] -->|出队·建索引·分类| R
  K --> P
  K --> L[模型服务]
  A --> L
```

- `apps/web` — 页面与 SSR。不承载业务逻辑，所有数据经 `apps/api`。
- `apps/api` — 全部 HTTP 接口、鉴权、权限、领域逻辑。
- `apps/worker` — 异步任务：知识库切块与向量化、工单自动分类、超时任务。
- `packages/shared` — 前后端共用的类型、DTO、错误码。契约的唯一来源。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Next.js 16 (App Router) + TypeScript + Tailwind | 仅 UI 与 SSR |
| 后端 | NestJS 11 + TypeScript | 独立进程、独立端口 |
| 数据库 | PostgreSQL 16 + pgvector | 业务数据与向量同库 |
| 缓存/队列 | Redis 7 + BullMQ | 队列、限流计数、会话黑名单 |
| ORM | Prisma（常规 CRUD）+ 原生 SQL（向量、聚合） | 见 ADR-0004 |
| 容器 | Docker Compose | 本地与单机生产同构 |
| 入口 | Nginx | 反向代理、TLS、静态缓存 |
| CI | GitHub Actions | 测试、构建镜像、部署 |

## 目录

```
ticket-platform/
├── apps/
│   ├── api/                 NestJS 服务
│   ├── web/                 Next.js 应用
│   └── worker/              异步任务进程
├── packages/
│   └── shared/              共享类型、DTO、错误码
├── infra/
│   ├── docker/init/         数据库初始化脚本（扩展、角色）
│   ├── docker/migrate.sh    容器启动时的一次性迁移脚本
│   └── nginx/               反向代理与 TLS 配置
├── docs/
│   ├── erd.md               数据模型
│   ├── api-v1.md            接口契约
│   ├── response-format.md   统一响应与错误码
│   ├── conventions.md       提交、分支、命名规范
│   └── adr/                 架构决策记录
├── Dockerfile               多阶段构建：deps -> build -> migrate / runner
├── docker-compose.yml       app + postgres + redis + 一次性 migrate
└── .env.example
```

## 本地启动

### 一条命令跑整套（Docker）

新机器只需要 Docker：

```bash
cp .env.example .env          # 首次
docker compose up -d --build
curl http://localhost:4000/api/v1/health/ready
```

API 文档 `http://localhost:4000/api/v1/docs`，首次启动自动建管理员（账号见 `.env` 的 `BOOTSTRAP_ADMIN_*`）。详见 [开发环境搭建](docs/dev-setup.md) 第七节。

### 开发模式（宿主机热重载）

前置：Docker Desktop、Node 22、pnpm。

```bash
pnpm install
pnpm db:up                    # 只起 PostgreSQL 与 Redis
pnpm db:psql                  # 验证连通
pnpm api:dev                  # API 跑在 4800，改代码即时重载
```

## 部署与 CI/CD

推送到 `master` 后自动完成：类型检查与测试 → 构建镜像推 `ghcr.io` → SSH 到服务器拉新镜像重建容器 → 构建前端并传到宿主机 → 公网冒烟。

```
.github/workflows/ci.yml     PR 与复用的验证流水线（起 Postgres/Redis 服务容器，跑迁移、seed、测试）
.github/workflows/deploy.yml 构建镜像 + 构建前端 + 部署
docker-compose.prod.yml      生产覆盖层：镜像从 ghcr 拉，不在服务器上构建
```

前端**不进 Docker**：`vite build` 的产物是纯静态文件，由 `deploy.yml` 里的 `web` job 直接传到服务器 `/var/www/ticket-web`，宿主机 Nginx 从那儿读。少一层容器、少一次镜像 pull。

线上结构：

```
https://xin2win.top            前端静态文件（history 路由回落到 index.html）
https://api.xin2win.top/api/v1 接口（Nginx 反代到 127.0.0.1:4000）
```

两个域各用同一张证书（`--expand` 把 `api` 加进 SAN），不需要分别续期。服务器上通过 `.env` 里的 `COMPOSE_FILE` 固定加载覆盖层，日常仍然用 `docker compose ps / logs` 这类短命令，不用每次带两个 `-f`。

需要在仓库 Settings → Secrets and variables → Actions 里配三个 secret：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`（私钥全文）。

## 日志与运维

日志有两份，分工不同：

```
容器 stdout  → /var/lib/docker/containers/<id>/*-json.log   上限 10m × 5，docker compose logs 查
应用文件     → ~/ticket-platform/logs/app.log               宿主机挂载，logrotate 按天切，留 14 天
```

两份都是应用的同一次输出（`JsonLogger` 双写），区别在于**谁能轮转它**。Docker 那份的句柄握在 dockerd 手里，logrotate 用 `copytruncate` 会把正在写的半行 JSON 截断，用默认的 `create` 模式又会让 dockerd 继续往改名后的旧文件写。所以按天归档只能针对应用自己打开的文件。

```
infra/backup/pg-backup.sh     每日 pg_dump -Fc，含完整性校验、7 天滚动清理
infra/logrotate/ticket-app    应用日志按天归档
```

安装（服务器上执行一次）：

```bash
sudo cp infra/logrotate/ticket-app /etc/logrotate.d/ticket-app
sudo logrotate -d /etc/logrotate.d/ticket-app     # 干跑，只打印不执行
sudo logrotate -f /etc/logrotate.d/ticket-app     # 立即切一次，验证

( crontab -l 2>/dev/null | grep -v 'pg-backup.sh'; \
  echo '17 3 * * * /home/ubuntu/ticket-platform/infra/backup/pg-backup.sh >> /var/backups/ticket/backup.log 2>&1' ) | crontab -
```

备份目录 `/var/backups/ticket` 权限 `700`、dump 文件 `600`：里面是全库明文数据。**备份和数据库在同一块盘上**，当前只能防误删和迁移出错，防不了磁盘损坏——异地存储留待后续。

## 环境变量

全部通过根目录 `.env` 注入，代码中不出现任何硬编码连接串或密钥。字段说明见 `.env.example`。

## 文档

- [数据模型](docs/erd.md)
- [接口契约 v1](docs/api-v1.md)
- [统一响应与错误码](docs/response-format.md)
- [工程规范](docs/conventions.md)
- [架构决策记录](docs/adr/)
