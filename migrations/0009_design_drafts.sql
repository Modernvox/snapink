CREATE TABLE IF NOT EXISTS design_drafts (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  variant TEXT NOT NULL CHECK (variant IN ('standard','billboard')),
  size INTEGER NOT NULL CHECK (size BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','reviewed','contacted')),
  draft_json TEXT NOT NULL,
  artwork_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  source_artwork_key TEXT,
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending','sent','failed')),
  notification_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_drafts_status_created ON design_drafts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_drafts_customer_email ON design_drafts(customer_email, created_at DESC);
CREATE TABLE IF NOT EXISTS design_draft_rate_limits (
  ip_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window_start)
);
