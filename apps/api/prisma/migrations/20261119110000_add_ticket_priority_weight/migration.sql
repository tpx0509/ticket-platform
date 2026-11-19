-- 按优先级排序：数据库排不了业务顺序，得先给它一个「权重」。
--
-- tickets.priority 是 text + CHECK 约束（'low' | 'normal' | 'high' | 'urgent'），
-- 直接 ORDER BY priority 得到的是字典序：
--     high < low < normal < urgent
-- 而业务要的是：
--     low < normal < high < urgent
-- 这两个顺序不一样，而且字典序的结果看起来"也挺整齐"，很容易被当成没问题。
--
-- 为什么不加普通 int 列：普通列要在每个写入点手动维护（现在的 create、
-- 以后可能的"改优先级"接口、批量导入脚本、后台直接改库），漏一处就会留下
-- 「权重和优先级对不上」的脏数据，不会报任何错，只表现为排序偶尔不对。
--
-- GENERATED ALWAYS AS ... STORED 由数据库自己算：写入方永远不用关心这一列，
-- 改 priority 它自动跟着变，不可能不一致。代价是它不能被写入，也不能被 ALTER。
--
-- ⚠️ 以后用 prisma migrate dev 自动生成迁移时，务必检查生成的文件里有没有
--    DROP COLUMN "priority_weight" 或 ALTER COLUMN ... DROP DEFAULT 这类语句。
--    Prisma 的 schema 语法表达不了生成列，它可能认为库比 schema 多了东西。
--    看到就删掉，否则会把这个列连同索引一起抹掉。

ALTER TABLE "tickets" ADD COLUMN "priority_weight" integer
  GENERATED ALWAYS AS (
    CASE "priority"
      WHEN 'low'    THEN 1
      WHEN 'normal' THEN 2
      WHEN 'high'   THEN 3
      WHEN 'urgent' THEN 4
      ELSE 0
    END
  ) STORED;

-- 按优先级排序的查询形状：(org_id, priority_weight, id)
-- 带 id 是因为同一权重有多条（比如 31 条 high），
-- 翻页要靠它做 tiebreaker，否则同一权重的边界上会重复或漏行。
CREATE INDEX "tickets_org_id_priority_weight_id_idx"
  ON "tickets" ("org_id", "priority_weight", "id");
