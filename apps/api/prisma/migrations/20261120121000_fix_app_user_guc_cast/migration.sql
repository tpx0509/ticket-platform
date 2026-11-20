-- 修 20261120120000 里的一个坑：空字符串 cast 成 uuid 会直接报错
--
-- 现象：详情接口 500，日志是
--   Invalid input value: invalid input syntax for type uuid: ""
-- 抛在 OrgMemberGuard 的 membership 查询里 —— 一个跟 user 上下文无关的请求。
--
-- 原因：current_setting('app.user_id', true) 只在「参数名从未出现过」时返回 NULL。
-- 一旦某个连接上执行过 set_config('app.user_id', ...)（is_local=true），
-- 事务结束后值被重置，但参数名留在了这个会话里，此后 current_setting 返回的是
-- 空字符串而不是 NULL。''::uuid 直接抛错，于是所有复用该连接的后续请求全 500。
--
-- 连接池复用的正是连接，所以这个坑只在「先调过 /orgs、再调别的接口」时出现 ——
-- 典型的时序 bug：测试单独跑一个接口永远发现不了。
--
-- 解法：nullif(current_setting(..., true), '')::uuid。
-- 未设置 / 已重置两种情况都归一成 NULL，比较结果为 NULL（等价 false），不报错。
--
-- app.org_id 也一起改：withUser 的事务里它是空的，同一个坑。

DROP POLICY "tenant_isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
  USING (
    "org_id" = nullif(current_setting('app.org_id', true), '')::uuid
    OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);

DROP POLICY "tenant_isolation" ON "organizations";
CREATE POLICY "tenant_isolation" ON "organizations"
  USING (
    "id" = nullif(current_setting('app.org_id', true), '')::uuid
    OR "id" IN (
      SELECT m."org_id" FROM "memberships" m
      WHERE m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
  WITH CHECK ("id" = nullif(current_setting('app.org_id', true), '')::uuid);
