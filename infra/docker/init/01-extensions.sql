-- 数据库初始化：只在数据卷为空时执行一次。
-- 这里只装扩展、建角色，不建业务表 —— 业务表由 Prisma 迁移管理。

-- 向量检索。知识库切块的 embedding 存在这里，配 HNSW 索引。
CREATE EXTENSION IF NOT EXISTS vector;

-- 三元组模糊匹配。用于工单标题/正文的 LIKE '%关键词%' 走索引，
-- 也用于混合检索里的关键词召回。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 大小写不敏感文本比较，用于邮箱唯一约束
CREATE EXTENSION IF NOT EXISTS citext;

-- 迁移与本地开发用同一个角色即可；只读角色在上线前单独建。
-- 这里留一个占位注释，避免有人以为忘了写。
