#!/usr/bin/env bash
#
# PostgreSQL 逻辑备份：每次一份 dump，保留 N 天。
#
# 三个关键选择，都不是随便定的：
#
# 1. 用容器里的 pg_dump，不用宿主机的
#    宿主机根本不需要装 psql 客户端，少一样要维护的东西。
#    更重要的是版本：pg_dump 的版本不能低于服务端，容器里就是 pg16，天然对齐。
#    宿主机哪天 apt 装了个 pg_dump 15，备份会直接报 "server version mismatch"。
#
# 2. 用 -Fc（custom 格式），不用纯 SQL 文本
#    自带压缩；能 pg_restore 选择性恢复单张表；恢复时可以并行、可以跳过已存在对象。
#    纯 SQL 文本只能整库重放，出问题时没有回旋余地。
#
# 3. 备份完要校验，不能只看文件存在
#    磁盘写满时 pg_dump 会在中途失败，留下一个几 KB 的残缺文件 —— 看起来像备份，
#    恢复时才发现读不了。所以必须用 pg_restore --list 实际解析一遍目录。

set -euo pipefail

# cron 的 PATH 极简（通常只有 /usr/bin:/bin），不补 docker 的位置会报 command not found。
# 用追加而不是覆盖：万一 docker 装在非常规路径（比如 /snap/bin），原 PATH 里还留着。
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

PROJECT_DIR="${PROJECT_DIR:-$HOME/ticket-platform}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ticket}"
KEEP_DAYS="${KEEP_DAYS:-7}"

cd "$PROJECT_DIR"

mkdir -p "$BACKUP_DIR"
# 700：dump 里有全库数据，同机其他账号不该读得到
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/ticket-$STAMP.dump"

# 中途任何一步失败（容器没起、磁盘满、pg_dump 报错），都把这个半成品删掉。
# 留着最危险：下次看目录「有昨天的备份」就放心了，实际是个读不了的残片。
trap 'rm -f "$FILE"' ERR

# -T 关闭伪终端分配。不加的话 pg_dump 以为自己在终端里跑，输出可能夹带 \r，
# 重定向成文件后就是一个损坏的二进制。
# 用户名和库名不在这里写死，交给容器里的 $POSTGRES_USER / $POSTGRES_DB —— 
# compose 已经把 .env 的值注入进去了，脚本不用重复解析一遍环境变量。
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$FILE"

chmod 600 "$FILE"

# 空文件 = 没导出成功（比如容器没起、连接被拒）
if [ ! -s "$FILE" ]; then
  echo "[$(date '+%F %T')] 失败：dump 文件为空 $FILE" >&2
  rm -f "$FILE"
  exit 1
fi

# 真正读一遍目录：能解析出对象列表，才说明文件完整。
# 损坏的 dump 在这一步会报 "did not find magic string in file header"。
if ! docker compose exec -T postgres pg_restore --list < "$FILE" > /dev/null 2>&1; then
  echo "[$(date '+%F %T')] 失败：dump 文件校验不通过（可能被截断）$FILE" >&2
  exit 1
fi

# 滚动删除：只删 ticket-*.dump，不碰目录里其他东西
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ticket-*.dump' -mtime +"$KEEP_DAYS" -delete

SIZE="$(du -h "$FILE" | cut -f1)"
COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ticket-*.dump' | wc -l)"
echo "[$(date '+%F %T')] 成功 $(basename "$FILE") ${SIZE}，当前共 ${COUNT} 份"
