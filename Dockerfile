# syntax=docker/dockerfile:1.7
# ↑ 语法指令必须是第一行。BuildKit 靠它识别文件格式，也靠它开放 RUN --mount=type=cache。

# node:22-alpine 与 engines 里的 >=22 对齐；alpine 让基础层从 ~1.1GB 降到 ~140MB。
# 代价是 musl libc：原生模块必须提供 musl 预编译包（@node-rs/argon2 有）。
FROM node:22-alpine AS base

# pnpm 版本锁死：corepack 会读 package.json 的 packageManager，
# 但 CI 里显式 prepare 一次更稳，也避免 corepack 每次去网上确认版本。
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
    && pnpm config set store-dir /pnpm/store --location=global
WORKDIR /repo

# ---------------------------------------------------------------- 依赖层
# 只有 manifest 和 lockfile。代码改动不会让这一层失效，
# 重建时直接命中缓存，这是「分层缓存」真正省时间的地方。
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# --filter @ticket/api... 只装 api 及其依赖，不装 web 的 Vue/Element Plus。
# --frozen-lockfile 保证镜像里的依赖与仓库 lockfile 完全一致，装出别的版本就构建失败。
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @ticket/api...

# ---------------------------------------------------------------- 构建层
# 生成的 dist 和 deploy 出来的生产依赖都留在这里，给最后的 runner 层取用。
FROM deps AS build

# prisma.config.ts 在加载时就会校验连接串存在，缺了直接抛错。
# 这里只需要「有一个合法格式的值」让它过校验，generate 不连库。
ENV DATABASE_URL_MIGRATE=postgresql://build:build@127.0.0.1:5432/build

COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY infra/docker ./infra/docker

RUN pnpm --filter @ticket/api prisma:generate \
    && pnpm --filter @ticket/api build

# pnpm deploy 把一个 workspace 包抽成「可以单独运行」的目录：
# node_modules 只含它自己的生产依赖，符号链接一并复制过去。
RUN pnpm --filter @ticket/api deploy --prod /out \
    # 这些是 deploy 顺带复制进来的源码和工具链配置，运行时用不到，删掉压体积
    && rm -rf /out/src /out/prisma /out/prisma.config.ts /out/tsconfig.json \
              /out/tsconfig.tsbuildinfo /out/nest-cli.json /out/vitest.config.mts /out/.data \
    # @prisma/client 把 prisma 声明成 peer 依赖，而我们开了 auto-install-peers，
    # 于是 CLI、Studio、pglite 这些构建期工具被当成生产依赖打了进来（约 150MB）。
    # 运行时的 client 走驱动适配器，不加载它们，这里直接剃掉。
    && rm -rf /out/node_modules/.pnpm/prisma@* \
              /out/node_modules/.pnpm/@prisma+engines@* \
              /out/node_modules/.pnpm/@prisma+studio-core@* \
              /out/node_modules/.pnpm/@prisma+dev@* \
              /out/node_modules/.pnpm/@electric-sql+* \
              /out/node_modules/.pnpm/react@* \
              /out/node_modules/.pnpm/react-dom@* \
              /out/node_modules/.pnpm/elkjs@* \
              /out/node_modules/.pnpm/effect@*

# ---------------------------------------------------------------- 迁移层
# 一次性任务用的镜像：有 prisma CLI、迁移文件、源码和 psql，随时可以跑 migrate。
# 它和运行层是两个 target，共享上面全部缓存，所以多这一层不会多编译一次。
FROM build AS migrate

# psql 只在这一层装：容器里用它执行 alter role（密码不写进迁移文件）。
RUN apk add --no-cache postgresql-client

ENTRYPOINT ["sh", "infra/docker/migrate.sh"]

# ---------------------------------------------------------------- 运行层
# 最终镜像 = 生产依赖 + 编译产物 + 一个非 root 用户，没有源码、没有 devDependencies。
FROM base AS runner

ENV NODE_ENV=production \
    API_PORT=4000 \
    STORAGE_LOCAL_DIR=/data/uploads

WORKDIR /app
# --chown 在 COPY 时就写好属主，不会多出一层。
# 反过来用 RUN chown -R 会重写每一个文件，镜像直接翻倍。
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist

# 上传目录要在镜像里就归属 node 用户：命名卷首次挂载会继承镜像里这个目录的属主，
# 否则容器以 node 身份运行时对 /data/uploads 没有写权限。
RUN mkdir -p /data/uploads && chown node:node /data/uploads

# 以非 root 运行。容器里 root 逃逸的代价比普通进程大得多，这一行不花成本。
USER node

EXPOSE 4000

# 存活探针：只证明进程还在，不碰数据库。就绪探针由 compose 覆盖成 /health/ready。
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
    CMD wget -qO- http://127.0.0.1:${API_PORT}/health || exit 1

# 直接 exec node，不用 npm start / sh -c：
# PID 1 就是 node 本身，SIGTERM 才能被 Nest 的 shutdown hooks 收到并优雅退出。
CMD ["node", "dist/main.js"]
