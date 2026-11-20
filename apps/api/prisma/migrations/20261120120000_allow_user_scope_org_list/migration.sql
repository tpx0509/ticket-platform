-- 组织切换器：允许按「当前用户」而不是「当前组织」读 memberships / organizations
--
-- 问题：登录后前端要问「我加入了哪些组织」。这个问题在拿到 org_id 之前就该有答案，
-- 而 RLS 策略只认 app.org_id —— 不知道租户就一条也读不到，连自己也看不到。
--
-- 解法：给策略加一个 user 分支。仍然只读不写：
--   USING      允许「本组织内」或「属于我」的行
--   WITH CHECK 仍然只认 app.org_id，插入 / 更新跨租户照样被拦
--
-- 顺带修一个隐患：current_setting 加了 missing_ok = true。
-- 原来的写法在参数未设置时会直接报错
-- "unrecognized configuration parameter app.org_id"，
-- 换成 true 之后返回 NULL，比较结果是 NULL（当成 false），
-- 表现是「查不到」而不是「整个请求 500」。
-- 这也是新加的 withUser 能工作的前提：它只设 app.user_id，不设 app.org_id。

-- ---------------------------------------------------------------- memberships
DROP POLICY "tenant_isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
  USING (
    "org_id" = current_setting('app.org_id', true)::uuid
    OR "user_id" = current_setting('app.user_id', true)::uuid
  )
  WITH CHECK ("org_id" = current_setting('app.org_id', true)::uuid);

-- -------------------------------------------------------------- organizations
-- 第二个分支是子查询：能看见的只有「我是成员的那些组织」。
-- 子查询里的 memberships 同样受它自己的策略约束，而那边的 user 分支正好放行，
-- 所以这条能命中，也不会递归（两个策略引用的不是同一张表）。
DROP POLICY "tenant_isolation" ON "organizations";
CREATE POLICY "tenant_isolation" ON "organizations"
  USING (
    "id" = current_setting('app.org_id', true)::uuid
    OR "id" IN (
      SELECT m."org_id" FROM "memberships" m
      WHERE m."user_id" = current_setting('app.user_id', true)::uuid
    )
  )
  WITH CHECK ("id" = current_setting('app.org_id', true)::uuid);
