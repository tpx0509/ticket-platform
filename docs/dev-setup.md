# 开发环境搭建（Windows）

目标：本机具备 Node 22、pnpm、Docker（WSL2 后端），能一条命令起 PostgreSQL 与 Redis。

## 前置检查

| 项 | 要求 | 怎么确认 |
|---|---|---|
| 系统 | Windows 11，或 Windows 10 22H2 及以上 | `winver` |
| 虚拟化 | BIOS 中已开启 | 任务管理器 → 性能 → CPU → 右下角「虚拟化：已启用」 |
| 内存 | 建议 16GB 以上 | 任务管理器 → 性能 → 内存 |
| 权限 | 安装 WSL 与 Docker 需要管理员 | — |
| 系统策略 | 未被组策略禁用 WSL / Hyper-V | 见文末「企业策略限制」 |

虚拟化没开的话，先重启进 BIOS 打开 Intel VT-x 或 AMD-V（部分主板叫 SVM），否则后面 WSL2 起不来，Docker 会一直转圈。

## 一、安装 WSL2

以**管理员身份**打开 PowerShell：

```powershell
wsl --install
```

这条命令会开启虚拟机平台与 WSL 功能、安装 WSL2 内核、并装一个 Ubuntu 发行版。完成后**重启电脑**。

重启后 Ubuntu 会自动打开，要求创建 Linux 用户名和密码。用户名用小写无空格，例如 `dev`。

验证：

```powershell
wsl -l -v
```

`VERSION` 列必须是 `2`。若是 `1`：

```powershell
wsl --set-version Ubuntu 2
wsl --set-default-version 2
```

## 二、安装 Docker Desktop

```powershell
winget install -e --id Docker.DockerDesktop
```

或从 Docker 官网下载安装包。安装过程中保持勾选 **Use WSL 2 instead of Hyper-V**。

安装完成后注销并重新登录（或重启），然后从开始菜单启动 Docker Desktop，等右下角鲸鱼图标变为稳定状态。

## 三、首次启动后的三项配置

打开 Docker Desktop → Settings（右上角齿轮）。

**1. Resources → WSL Integration**
打开 `Enable integration with my default WSL distro`，并勾选 Ubuntu 那一项。不开这个，在 WSL 里执行 `docker` 会找不到命令。

**2. Resources → Advanced → Disk image location**
默认位置在 C 盘用户目录，几个镜像就能吃掉几十 GB。改到空间充足的盘，例如 `E:\docker-data`。**改完会重新拉取镜像，所以要在第一次 `docker pull` 之前改。**

**3. Resources → Advanced → Memory**
给 Docker 分配的内存限制在 2~4GB 即可。本项目跑 PostgreSQL 与 Redis，2GB 足够；分配过多会让 Windows 本身变卡。

改完点 `Apply & restart`。

## 四、配置镜像加速

国内直连 Docker Hub 拉取镜像经常超时。Settings → Docker Engine，在 JSON 里加入 `registry-mirrors`，**保留已有字段**：

```json
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.m.daocloud.io",
    "https://mirror.ccs.tencentyun.com"
  ]
}
```

多个源会按顺序尝试，前一个失败自动切下一个。可用性随时间变化，2026 年以来多个公共源已关停（如中科大 `docker.mirrors.ustc.edu.cn`），若全部失效需换新源。

点 `Apply & restart`。验证：

```powershell
docker info --format "{{json .RegistryConfig.Mirrors}}"
```

## 五、验证安装

在**新的** PowerShell 窗口执行：

```powershell
docker version            # 必须同时有 Client 和 Server 两段
docker compose version    # 输出 v2.x
docker run --rm hello-world
```

`docker version` 只有 Client 段、或报 `error during connect`，说明引擎没起来——先确认 Docker Desktop 已启动且鲸鱼图标正常。

注意是 `docker compose`（中间空格），带横线的 `docker-compose` 是已废弃的 v1。

## 六、验证本项目基础设施

```powershell
cd E:\newProject\ticket-platform
pnpm db:up
docker compose ps
pnpm db:psql       # 应输出 PostgreSQL 16.x
pnpm db:redis      # 应输出 PONG
```

`pnpm db:up` 会用 `docker-compose.yml` 拉起：

- `pgvector/pgvector:pg16` — PostgreSQL 16 + 向量扩展，端口 5432
- `redis:7-alpine` — 端口 6379

首次启动会自动执行 `infra/docker/init/01-extensions.sql`，安装 `vector`、`pg_trgm`、`pgcrypto`、`citext` 四个扩展。

验证扩展是否装上：

```bash
docker compose exec postgres psql -U ticket -d ticket_dev -c "\dx"
```

应能看到 `vector`。看不到说明初始化脚本没执行——它**只在数据卷为空时运行一次**，需要 `pnpm db:reset` 清卷重建。

数据库可视化客户端（可选）：

```powershell
docker compose --profile tools up -d adminer
```

访问 `http://localhost:8080`，服务器填 `postgres`，用户名 `ticket`，密码见 `.env`，库名 `ticket_dev`。

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| `docker: command not found` | Docker Desktop 未启动，或安装后未重开终端 | 启动 Docker Desktop，重开终端 |
| `error during connect ... dockerDesktopLinuxEngine` | 引擎未运行 | 启动 Docker Desktop，等图标稳定 |
| 启动一直转圈 | BIOS 未开虚拟化，或 WSL2 未安装 | 检查任务管理器虚拟化状态；`wsl --update` |
| 拉取镜像超时 | 未配镜像加速，或源已失效 | 按第四节配置；换 `docker.1ms.run` |
| `port is already allocated` | 5432 / 6379 被本机已有服务占用 | 关掉本机 PostgreSQL/Redis，或改 `.env` 里的 `POSTGRES_PORT` |
| `\dx` 里没有 vector | 初始化脚本未执行 | `pnpm db:reset`（会清空数据） |
| 容器内脚本报 `bash\r` | 文件是 CRLF 换行 | 仓库已用 `.gitattributes` 统一为 LF，重新 clone 或 `git add --renormalize .` |

## 企业策略限制

如果这台机器受公司管控，可能出现：

- `wsl --install` 报错说被组策略禁用
- Docker Desktop 启动提示需要 Hyper-V 但无权开启
- 安全软件拦截虚拟化

这种情况下本机跑容器走不通，改用远程方案：申请一台 Linux 云主机（2C4G 即可），在服务器上装 Docker，本地通过 SSH 端口转发把 5432 / 6379 映射到本机开发。这种方式与生产环境更接近，但需要网络通畅，且开发期数据库在远端会有延迟。

远程方案需要联系 IT 确认策略，不能绕过。
