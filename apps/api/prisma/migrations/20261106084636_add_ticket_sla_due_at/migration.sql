-- 本次迁移的意图只有两件事：
--   1. tickets 加 sla_due_at（SLA 到期时间）
--   2. 加 (org_id, sla_due_at) 索引，支撑"某组织快到期 / 已超期"的查询
--
-- ⚠️ prisma migrate dev 自动生成时额外塞了三类语句，已手工删掉：
--   DROP INDEX "kb_chunks_embedding_hnsw_idx"
--   DROP INDEX "tickets_subject_trgm_idx"
--   ALTER TABLE ... ALTER COLUMN "updated_at" DROP DEFAULT   （6 张表各一条）
--
-- 原因：这些对象是 init 迁移里手写建的（见那里第 1、5、6 节），
-- schema.prisma 表达不了 GIN trigram、HNSW 和库级默认值。Prisma 在 schema 里
-- 看不到它们，就认为库比 schema 多了东西，每次生成迁移都要 DROP 掉。
--
-- 教训：自动生成的迁移必须逐行看。DROP DEFAULT 影响不大，
-- DROP INDEX 是直接抹掉一条线上查询的支撑，属于事故级。

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "sla_due_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "tickets_org_id_sla_due_at_idx" ON "tickets"("org_id", "sla_due_at");
