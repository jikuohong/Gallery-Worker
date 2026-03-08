-- ============================================================
--  Gallery D1 数据库 Schema
--  执行命令：wrangler d1 execute gallery-db --file=schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS images (
  id              TEXT    PRIMARY KEY,
  image_url       TEXT    NOT NULL,
  prompt          TEXT    DEFAULT '',
  original_prompt TEXT    DEFAULT '',
  model           TEXT    DEFAULT '',
  width           INTEGER DEFAULT 0,
  height          INTEGER DEFAULT 0,
  seed            INTEGER DEFAULT 0,
  enhance         INTEGER DEFAULT 0,    -- 0 / 1（SQLite 没有 BOOLEAN）
  ai_desc         TEXT    DEFAULT '',
  ai_tags         TEXT    DEFAULT '[]', -- JSON 数组字符串
  prompt_tags     TEXT    DEFAULT '[]', -- JSON 数组字符串
  search_text     TEXT    DEFAULT '',   -- 多字段拼接，供 LIKE 搜索
  ts              INTEGER NOT NULL,     -- Unix 毫秒时间戳
  source          TEXT    DEFAULT 'generated',
  metadata        TEXT    DEFAULT ''    -- 完整记录 JSON 备份（兼容用）
);

-- 时间倒序索引（分页列表核心索引）
CREATE INDEX IF NOT EXISTS idx_images_ts     ON images (ts DESC);

-- 搜索字段索引（加速 LIKE 搜索）
CREATE INDEX IF NOT EXISTS idx_images_search ON images (search_text);

-- 图片 URL 唯一索引（导入去重，O(1) 查询，替代原来的全量扫描）
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_url ON images (image_url);
