-- 幂等键：客户端为「同一次建单意图」生成的 uuid，重发时原样带回。
-- 应用层不做「先查后插」，而是直接插入、让这份唯一约束兜底，
-- 冲突了再回查第一次建好的那条 —— 先查后插在并发下两个请求会同时查到「没有」。
ALTER TABLE "tickets" ADD COLUMN "idempotency_key" uuid;

CREATE UNIQUE INDEX "tickets_org_id_idempotency_key_key"
  ON "tickets" ("org_id", "idempotency_key");
