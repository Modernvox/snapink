CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  variant TEXT NOT NULL CHECK (variant IN ('standard','billboard')),
  size INTEGER NOT NULL CHECK (size BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','ready','in_production','completed','shipped','cancelled')),
  draft_json TEXT NOT NULL,
  artwork_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  artwork_sha256 TEXT NOT NULL,
  preview_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
CREATE TABLE IF NOT EXISTS production_jobs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  status TEXT NOT NULL CHECK (status IN ('queued','downloaded','opened','failed','completed')),
  model_key TEXT NOT NULL,
  model_sha256 TEXT NOT NULL DEFAULT '',
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE production_jobs ADD COLUMN claim_device TEXT;
ALTER TABLE production_jobs ADD COLUMN claim_expires TEXT;
CREATE TABLE IF NOT EXISTS production_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  paired_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS production_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES production_jobs(id),
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE orders ADD COLUMN source_artwork_key TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN source_artwork_sha256 TEXT NOT NULL DEFAULT '';
