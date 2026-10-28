CREATE TABLE IF NOT EXISTS photo_renderer_heartbeats (
  device_id TEXT PRIMARY KEY REFERENCES production_devices(id),
  state TEXT NOT NULL CHECK (state IN ('idle','paused_orca','rendering','uploading')),
  current_job_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_renderer_heartbeat_updated
  ON photo_renderer_heartbeats(updated_at DESC);
