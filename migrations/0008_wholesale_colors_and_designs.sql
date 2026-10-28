-- Additive wholesale catalog and Studio snapshots. Migration 0007 remains untouched.
CREATE TABLE IF NOT EXISTS wholesale_color_catalog (
  id TEXT PRIMARY KEY,
  manufacturer TEXT NOT NULL CHECK (manufacturer IN ('Overture','EONO')),
  official_color_name TEXT NOT NULL,
  manufacturer_sku TEXT,
  preview_hex TEXT NOT NULL CHECK (length(preview_hex)=7 AND substr(preview_hex,1,1)='#'),
  material_type TEXT NOT NULL DEFAULT 'TPU 95A',
  finish TEXT NOT NULL DEFAULT 'matte',
  availability_status TEXT NOT NULL DEFAULT 'unverified' CHECK (availability_status IN ('available','unavailable','unverified')),
  admin_enabled INTEGER NOT NULL DEFAULT 0 CHECK (admin_enabled IN (0,1)),
  source_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(manufacturer, official_color_name)
);

CREATE TABLE IF NOT EXISTS wholesale_designs (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES wholesale_partners(id),
  design_name TEXT NOT NULL DEFAULT 'Custom sleeve design',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  sleeve_style TEXT NOT NULL CHECK (sleeve_style IN ('standard','billboard')),
  sleeve_size INTEGER NOT NULL CHECK (sleeve_size BETWEEN 0 AND 6),
  base_color_id TEXT NOT NULL REFERENCES wholesale_color_catalog(id),
  artwork_colors_json TEXT NOT NULL DEFAULT '[]',
  draft_json TEXT NOT NULL,
  artwork_svg_key TEXT NOT NULL,
  artwork_svg_sha256 TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  preview_sha256 TEXT NOT NULL,
  source_artwork_key TEXT,
  source_artwork_sha256 TEXT,
  source_artwork_name TEXT,
  geometry_version TEXT NOT NULL,
  positioning_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(partner_id,id,version)
);
CREATE TABLE IF NOT EXISTS wholesale_color_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  color_id TEXT NOT NULL REFERENCES wholesale_color_catalog(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wholesale_design_partner ON wholesale_designs(partner_id,updated_at DESC);

-- Overture explicitly labels these TPU variants matte. Availability is deliberately
-- unverified until an administrator confirms current supplier stock.
INSERT OR IGNORE INTO wholesale_color_catalog
  (id,manufacturer,official_color_name,preview_hex,material_type,finish,availability_status,admin_enabled,source_url,created_at,updated_at)
VALUES
  ('overture-matte-black','Overture','Matte Black','#000000','TPU 95A','matte','unverified',0,'https://overture3d.com/collections/new-arrival/products/overture-tpu',datetime('now'),datetime('now')),
  ('overture-matte-space-gray','Overture','Matte Space Gray','#90999D','TPU 95A','matte','unverified',0,'https://overture3d.com/collections/new-arrival/products/overture-tpu',datetime('now'),datetime('now')),
  ('overture-matte-gray','Overture','Matte Gray','#E2E7E9','TPU 95A','matte','unverified',0,'https://overture3d.com/collections/new-arrival/products/overture-tpu',datetime('now'),datetime('now')),
  ('overture-matte-white','Overture','Matte White','#FFFFFF','TPU 95A','matte','unverified',0,'https://overture3d.com/collections/new-arrival/products/overture-tpu',datetime('now'),datetime('now')),
  ('overture-matte-natural','Overture','Matte Natural','#E8F4F8','TPU 95A','matte','unverified',0,'https://overture3d.com/collections/new-arrival/products/overture-tpu',datetime('now'),datetime('now')),
  ('overture-matte-orange','Overture','Matte Orange','#FFA11D','TPU 95A','matte','unverified',0,'https://overture3d.com/collections/new-arrival/products/overture-tpu',datetime('now'),datetime('now')),
  ('overture-matte-yellow','Overture','Matte Yellow','#FFBF40','TPU 95A','matte','unverified',0,'https://overture3d.com/collections/new-arrival/products/overture-tpu',datetime('now'),datetime('now'));

ALTER TABLE wholesale_order_items ADD COLUMN sleeve_style TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN base_color_id TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN base_color_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE wholesale_order_items ADD COLUMN artwork_colors_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE wholesale_order_items ADD COLUMN wholesale_design_id TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN design_version INTEGER;
ALTER TABLE wholesale_order_items ADD COLUMN design_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE wholesale_order_items ADD COLUMN artwork_svg_key TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN artwork_svg_sha256 TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN source_artwork_key TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN source_artwork_sha256 TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN geometry_version TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN positioning_version TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN preview_key TEXT;
ALTER TABLE wholesale_order_items ADD COLUMN customization_quote_status TEXT NOT NULL DEFAULT 'not_required' CHECK (customization_quote_status IN ('not_required','pending_quote','confirmed'));
ALTER TABLE wholesale_orders ADD COLUMN customization_quote_status TEXT NOT NULL DEFAULT 'not_required' CHECK (customization_quote_status IN ('not_required','pending_quote','confirmed'));
