-- 迁移必须能在任何一个空库上从零重放，所以扩展也在迁移里创建，
-- 不能依赖 infra/docker/init 的初始化脚本 —— 那个脚本只在数据卷为空时执行一次，
-- 而 migrate dev 的 shadow database 每次都是全新的空库。
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invited_by" UUID,
    "joined_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "user_agent" TEXT,
    "ip" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "category" TEXT,
    "requester_id" UUID NOT NULL,
    "assignee_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'web',
    "first_response_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "ai_category" TEXT,
    "ai_confidence" DECIMAL(4,3),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "ticket_id" UUID,
    "comment_id" UUID,
    "uploader_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "author_id" UUID NOT NULL,
    "indexed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1024),

    CONSTRAINT "kb_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "ref_type" TEXT,
    "ref_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "tickets_org_id_status_created_at_idx" ON "tickets"("org_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_org_id_assignee_id_status_idx" ON "tickets"("org_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "tickets_org_id_created_at_idx" ON "tickets"("org_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_org_id_number_key" ON "tickets"("org_id", "number");

-- CreateIndex
CREATE INDEX "ticket_comments_ticket_id_created_at_idx" ON "ticket_comments"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_events_ticket_id_created_at_idx" ON "ticket_events"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_events_org_id_type_created_at_idx" ON "ticket_events"("org_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "attachments_org_id_ticket_id_idx" ON "attachments"("org_id", "ticket_id");

-- CreateIndex
CREATE INDEX "kb_articles_org_id_status_updated_at_idx" ON "kb_articles"("org_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "kb_chunks_org_id_article_id_idx" ON "kb_chunks"("org_id", "article_id");

-- CreateIndex
CREATE UNIQUE INDEX "kb_chunks_article_id_seq_key" ON "kb_chunks"("article_id", "seq");

-- CreateIndex
CREATE INDEX "ai_runs_org_id_created_at_idx" ON "ai_runs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_runs_kind_status_idx" ON "ai_runs"("kind", "status");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "ticket_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "kb_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 以下为手写部分。
-- Prisma schema 表达不了枚举约束、函数索引、GIN/HNSW 索引和触发器，
-- 但这几样是数据库层的硬约束 —— 写在文档里不等于存在。
-- ============================================================

-- ------------------------------------------------------------
-- 1. updated_at 兜底默认值
-- Prisma 在应用层维护 updated_at，但直接用 SQL 改数据时它不会被赋值。
-- 加一个库级默认值，手写 SQL 和后续的数据修复脚本都不会留下 NULL。
-- ------------------------------------------------------------
ALTER TABLE "organizations"   ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "users"           ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "memberships"     ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "tickets"         ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "ticket_comments" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "kb_articles"     ALTER COLUMN "updated_at" SET DEFAULT now();

-- ------------------------------------------------------------
-- 2. 枚举值：text + CHECK，不用 PG enum
-- enum 加值需要 ALTER TYPE ADD VALUE，且不能在事务里随便用；
-- 删值几乎做不到。text + CHECK 改约束只是一条普通 DDL。
-- ------------------------------------------------------------
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_ck"
  CHECK ("plan" IN ('free', 'pro'));

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_ck"
  CHECK ("role" IN ('owner', 'admin', 'agent', 'viewer'));
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_status_ck"
  CHECK ("status" IN ('invited', 'active', 'suspended'));

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_ck"
  CHECK ("status" IN ('open', 'pending', 'resolved', 'closed'));
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priority_ck"
  CHECK ("priority" IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_source_ck"
  CHECK ("source" IN ('web', 'email', 'api'));
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_number_ck"
  CHECK ("number" > 0);
-- 置信度必须落在 [0,1]，否则前端画进度条会算出负数宽度
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ai_confidence_ck"
  CHECK ("ai_confidence" IS NULL OR ("ai_confidence" >= 0 AND "ai_confidence" <= 1));

ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_type_ck"
  CHECK ("type" IN ('created', 'status_changed', 'assigned', 'priority_changed',
                    'category_changed', 'commented', 'attachment_added'));

ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_status_ck"
  CHECK ("status" IN ('draft', 'published', 'archived'));

ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_kind_ck"
  CHECK ("kind" IN ('classify', 'suggest', 'embed', 'ask'));
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_status_ck"
  CHECK ("status" IN ('success', 'failed', 'timeout'));
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_cost_ck"
  CHECK ("cost_micros" >= 0 AND "prompt_tokens" >= 0 AND "completion_tokens" >= 0);

-- ------------------------------------------------------------
-- 3. 邮箱与 slug：统一小写 + 数据库层强制
-- 不用 citext：Prisma 无法表达该类型，@unique 会与库里的类型产生漂移。
-- 改为写入前统一转小写，再用 CHECK 把这条规则钉死在数据库里 ——
-- 唯一索引本身区分大小写，只要保证存进去的都是小写，效果与 citext 等价。
-- ------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_ck"
  CHECK ("email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_email_format_ck"
  CHECK ("email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_lowercase_ck"
  CHECK ("slug" = lower("slug"));
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_format_ck"
  CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

-- ------------------------------------------------------------
-- 4. 附件必须挂在工单或评论上，不能两者皆空
-- 允许同时为空等于允许产生游离的孤儿记录，文件白白占存储。
-- ------------------------------------------------------------
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_target_ck"
  CHECK ("ticket_id" IS NOT NULL OR "comment_id" IS NOT NULL);

-- ------------------------------------------------------------
-- 5. 全文检索与模糊匹配
-- to_tsvector 用 'simple' 而不是 'english'：中文分词交给应用层，
-- 这里只做基础词元切分，避免英文词干化把中文话题搞乱。
-- 生产环境加索引要写 CREATE INDEX CONCURRENTLY，迁移里无法使用（事务内不允许）。
-- ------------------------------------------------------------
CREATE INDEX "tickets_fts_idx" ON "tickets"
  USING gin (to_tsvector('simple', "subject" || ' ' || "description"));

-- 支撑标题的 ILIKE '%关键词%'，普通 B+ 树对这种前后通配的查询无效
CREATE INDEX "tickets_subject_trgm_idx" ON "tickets"
  USING gin ("subject" gin_trgm_ops);

-- ------------------------------------------------------------
-- 6. 向量索引：HNSW + 余弦距离
-- HNSW 建索引慢、占内存，但查询快且支持增量插入；
-- IVFFlat 建得快，但要预先聚类，数据增长后需要重建。
-- 参数 m=16 控制每层连接数，ef_construction=64 控制建索引时的搜索宽度：
-- 调大更准更慢，调小更快更糊。这两个值是要在压测里调的。
-- ------------------------------------------------------------
CREATE INDEX "kb_chunks_embedding_hnsw_idx" ON "kb_chunks"
  USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ------------------------------------------------------------
-- 7. 审计表只追加
-- 审计表一旦能被改，就不叫审计。应用层不提供改删接口是第一道，
-- 这里是第二道：即使有人直连数据库，也改不动。
-- 注意外键是 RESTRICT 而不是 CASCADE —— 级联删除审计记录等于没有审计。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION "ticket_events_forbid_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ticket_events 是只追加表，禁止 % 操作', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ticket_events_no_update"
  BEFORE UPDATE ON "ticket_events"
  FOR EACH ROW EXECUTE FUNCTION "ticket_events_forbid_mutation"();

CREATE TRIGGER "ticket_events_no_delete"
  BEFORE DELETE ON "ticket_events"
  FOR EACH ROW EXECUTE FUNCTION "ticket_events_forbid_mutation"();
