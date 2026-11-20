#!/bin/sh
# 一次性任务：把数据库准备到「应用能启动」的状态，然后退出。
#
# 为什么单独一个服务而不是写进 app 的启动脚本：
#   迁移需要 owner 连接串、psql 和 prisma CLI，这些都不该进最终镜像。
#   拆开后，app 镜像里没有 DDL 能力，误操作也改不了表结构；
#   迁移失败时 app 根本不会启动，不会出现「半迁移状态对外服务」。
#
# 每一步都幂等：重复执行不会报错、不会覆盖数据。
set -eu

: "${DATABASE_URL_MIGRATE:?缺少 DATABASE_URL_MIGRATE（owner 连接串）}"
: "${APP_DB_PASSWORD:?缺少 APP_DB_PASSWORD（ticket_app 的密码）}"

echo "[migrate] 1/3 执行迁移"
# deploy 只跑未应用过的迁移，不生成新迁移、不重置数据，是给部署用的那条命令。
# 必须排在设密码之前：ticket_app 这个角色本身就是迁移建出来的，
# 空库上先执行 alter role 只会得到 "role does not exist"。
pnpm --filter @ticket/api exec prisma migrate deploy

echo "[migrate] 2/3 设置应用角色密码"
# 迁移里只写了 `alter role ticket_app login`，故意没有密码 ——
# 密码进 Git 等于把三个环境的密码写进版本历史。这里在容器启动时补上。
# 密码通过 psql 变量传，heredoc 用引号锁住不让 shell 展开：
# 密码里带引号、$、反斜杠都不会拼坏 SQL，也不会被 shell 解释成变量。
psql "$DATABASE_URL_MIGRATE" -v ON_ERROR_STOP=1 -q -v pw="$APP_DB_PASSWORD" <<'SQL'
alter role ticket_app with login password :'pw';
SQL

echo "[migrate] 3/3 初始化管理员"
# bootstrap 自带幂等：库里已有组织就直接跳过，不会覆盖任何数据。
# 没配 BOOTSTRAP_* 时明确跳过，而不是让脚本报错崩掉整个启动流程。
if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] && [ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  pnpm --filter @ticket/api exec tsx prisma/bootstrap.ts
else
  echo "[migrate] 未提供 BOOTSTRAP_*，跳过初始化（空库将没有任何账号可登录）"
fi

echo "[migrate] 完成"
