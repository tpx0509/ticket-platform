-- M3：行级安全（RLS）+ 受限应用角色
--
-- 目标：把「记得带 where org_id」从人的纪律变成数据库的强制约束。
-- 漏写租户条件时返回空集，而不是别人的数据。
--
-- ⚠️ 这份文件全是手写 DDL，schema.prisma 表达不了。
-- 它跟 init 里的 CHECK / GIN / HNSW / 触发器属于同一类：
-- Prisma 在 schema 里看不到，以后每次 migrate dev 都可能生成 DROP 语句把它们删掉。
-- 生成迁移时必须逐行 review，看到 DROP POLICY / DROP ROLE 一律删掉。

-- ---------------------------------------------------------------- 应用角色
--
-- 为什么必须是新角色：RLS 对超级用户和带 BYPASSRLS 的角色不生效，
-- 你现在用 ticket（superuser）连库，策略建了也等于没建。
--
-- CREATE ROLE 是集群级对象，不随 schema 重建，所以要用 DO 块判断存在性，
-- 否则 migrate reset 重放时会报 "role already exists"。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ticket_app') THEN
    CREATE ROLE ticket_app NOLOGIN;
  END IF;
END
$$;

-- 权限：只给 DML，不给 DDL。
-- 应用不该能 alter table / drop table，也不该能关掉自己的 RLS 策略。
GRANT USAGE ON SCHEMA public TO ticket_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ticket_app;

-- 以后新建的表自动授权给应用角色。没有这一句，每次加表都要手工 grant，
-- 忘了就是运行时 "permission denied for table xxx"。
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ticket_app;

-- 迁移记录表属于运维面，应用角色不该看见当前跑到第几版
REVOKE ALL ON TABLE _prisma_migrations FROM ticket_app;

-- ---------------------------------------------------------------- 开 RLS
--
-- enable  让策略对普通角色生效
-- force   连表 owner 也受策略约束（生产上 owner 往往是 DBA，不是应用角色，
--         但这一句能让本地用 owner 测试时也不出错）
--
-- USING     控制「哪些行能被看见 / 被更新 / 被删除」
-- WITH CHECK 控制「插入或更新后的行是否合法」
-- 两个都要写。只写 USING 的话，插入一条 org_id 是别人的记录不会被拦。

-- organizations：它就是租户本身，主键即租户标识
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("id" = current_setting('app.org_id')::uuid);

-- 其余业务表：统一按 org_id 隔离
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tickets"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

ALTER TABLE "ticket_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ticket_comments"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

ALTER TABLE "ticket_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ticket_events"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attachments"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

ALTER TABLE "kb_articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_articles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "kb_articles"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

ALTER TABLE "kb_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "kb_chunks"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_runs"
  USING ("org_id" = current_setting('app.org_id')::uuid)
  WITH CHECK ("org_id" = current_setting('app.org_id')::uuid);

-- ---------------------------------------------------------------- 不加 RLS 的表
--
-- users        一个人可以同时属于多个组织，本身不属于某个租户。
--              登录时还没确定 org_id，必须先按 email 查到人。加 RLS 会把登录打死。
--              应用层通过 memberships 收敛「能看到哪些人」，这里只做权限控制。
--
-- refresh_tokens 同上，按 user_id 组织，登录前就要读。
--
-- _prisma_migrations 迁移专用，上面已收回 application 角色的全部权限。
--
-- 这三张表是 RLS 覆盖不到的地方，越权风险要靠应用层兜住：
-- 任何返回用户信息的接口都必须过滤 memberships，不能直接 select users。

-- ---------------------------------------------------------------- 后续维护提醒
--
-- 1. 新增表如果带 org_id，必须在这里补 enable + force + policy。
--    RLS 不会自动套用，忘了就等于这张表完全裸奔。
-- 2. ALTER DEFAULT PRIVILEGES 只解决权限，不解决策略。
-- 3. 后台任务（worker）没有 HTTP 上下文，必须显式 set local app.org_id，
--    否则所有查询返回空集 —— 这是静默失败，不报错，最容易被当成"没数据"。
