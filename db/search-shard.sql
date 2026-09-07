CREATE TABLE IF NOT EXISTS catalog_products (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  audience TEXT NOT NULL,
  problem_excerpt TEXT NOT NULL,
  promise TEXT NOT NULL,
  source TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  intent_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_intent ON catalog_products(intent_key, id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_created ON catalog_products(created_at, id);

CREATE VIRTUAL TABLE IF NOT EXISTS catalog_products_fts USING fts5(
  slug UNINDEXED,
  intent_key UNINDEXED,
  search_text,
  tokenize='porter unicode61'
);

PRAGMA optimize;
