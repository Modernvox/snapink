CREATE TABLE IF NOT EXISTS photo_render_batches (
  id TEXT PRIMARY KEY,
  design_count INTEGER NOT NULL CHECK (design_count BETWEEN 1 AND 100),
  settings_json TEXT NOT NULL,
  asset_validation_status TEXT NOT NULL,
  render_mode TEXT NOT NULL CHECK (render_mode IN ('fast','premium')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_render_jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES photo_render_batches(id),
  status TEXT NOT NULL CHECK (status IN ('queued','rendering','completed','failed')),
  source_key TEXT NOT NULL,
  original_key TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  output_key TEXT,
  output_sha256 TEXT,
  output_bytes INTEGER,
  original_name TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  asset_validation_status TEXT NOT NULL,
  render_mode TEXT NOT NULL CHECK (render_mode IN ('fast','premium')),
  render_engine TEXT,
  render_duration_ms INTEGER,
  peak_gpu_memory_mb INTEGER,
  gpu_warning TEXT,
  error TEXT,
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  stage TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 1,
  worker_device TEXT,
  lease_expires TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_render_queue ON photo_render_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_photo_render_batch ON photo_render_jobs(batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_photo_render_gallery ON photo_render_jobs(status, updated_at DESC);
