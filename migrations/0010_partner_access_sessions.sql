ALTER TABLE wholesale_partners ADD COLUMN credential_expires_at TEXT;
ALTER TABLE wholesale_partners ADD COLUMN last_login_at TEXT;
ALTER TABLE wholesale_partners ADD COLUMN origin TEXT NOT NULL DEFAULT 'pilot' CHECK (origin IN ('pilot','admin'));

CREATE TABLE IF NOT EXISTS wholesale_partner_sessions (
  session_sha256 TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES wholesale_partners(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wholesale_partner_sessions_partner ON wholesale_partner_sessions(partner_id);
CREATE INDEX IF NOT EXISTS idx_wholesale_partner_sessions_expiry ON wholesale_partner_sessions(expires_at);

CREATE TABLE IF NOT EXISTS wholesale_partner_login_limits (
  ip_sha256 TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_sha256, window_started_at)
);
