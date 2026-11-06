-- M3 第二步：让应用角色能登录。
--
-- 上一条迁移建了 ticket_app 但设的是 NOLOGIN —— 那时它只是个权限容器，
-- 应用仍然用 ticket（superuser）连库，RLS 全程没生效过。
-- 这条把 login 打开，之后应用的连接串指向它，策略才真正起作用。
--
-- ⚠️ 这里只改属性，不设密码。
-- 密码不能出现在迁移文件里：迁移文件进 Git，等于把密码写进版本历史，
-- 而且开发、测试、生产三套环境的密码不该是同一个。
-- 密码由部署流程单独注入（本地是一次性 psql 命令，生产走密钥管理）：
--
--   alter role ticket_app password '...';   -- 在目标库上手工执行一次
--
-- 没设密码时连接会失败（password authentication failed），
-- 这是预期的报错方向 —— 宁可连不上，也不要用一个默认密码连上去。

alter role ticket_app login;

-- 生产上还应该限制它能从哪些地址连、能连几个库：
--   alter role ticket_app connection limit 20;
--   alter role ticket_app set default_transaction_read_only = off;
-- 这些按部署环境定，不写死在迁移里。
