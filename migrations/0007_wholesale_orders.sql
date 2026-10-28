CREATE TABLE IF NOT EXISTS wholesale_partners (
  id TEXT PRIMARY KEY,
  pilot_application_id INTEGER NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  token_sha256 TEXT NOT NULL UNIQUE,
  access_status TEXT NOT NULL DEFAULT 'active' CHECK (access_status IN ('active','suspended','revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS wholesale_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  partner_id TEXT NOT NULL REFERENCES wholesale_partners(id),
  idempotency_key TEXT NOT NULL,
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  shipping_address_json TEXT NOT NULL,
  billing_address_json TEXT NOT NULL,
  same_as_shipping INTEGER NOT NULL DEFAULT 0 CHECK (same_as_shipping IN (0,1)),
  total_quantity INTEGER NOT NULL CHECK (total_quantity BETWEEN 50 AND 10000),
  pricing_tier TEXT NOT NULL,
  merchandise_subtotal_cents INTEGER NOT NULL CHECK (merchandise_subtotal_cents >= 0),
  lead_time_code TEXT NOT NULL,
  lead_time_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','awaiting_artwork_approval','approved_awaiting_payment','scheduled_for_production','in_production','ready_to_ship','shipped','completed','cancelled')),
  custom_review_required INTEGER NOT NULL DEFAULT 0 CHECK (custom_review_required IN (0,1)),
  special_instructions TEXT NOT NULL DEFAULT '',
  admin_notes TEXT NOT NULL DEFAULT '',
  partner_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(partner_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS wholesale_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES wholesale_orders(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number BETWEEN 1 AND 50),
  size INTEGER NOT NULL CHECK (size BETWEEN 0 AND 6),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  design_type TEXT NOT NULL CHECK (design_type IN ('blank','approved_design','custom_branding')),
  design_id TEXT,
  design_reference TEXT NOT NULL DEFAULT '',
  design_notes TEXT NOT NULL DEFAULT '',
  artwork_key TEXT,
  artwork_sha256 TEXT,
  artwork_name TEXT,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0,1)),
  UNIQUE(order_id, line_number)
);

CREATE TABLE IF NOT EXISTS wholesale_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES wholesale_orders(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('partner','admin','system')),
  actor_id TEXT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wholesale_submission_limits (
  partner_id TEXT PRIMARY KEY REFERENCES wholesale_partners(id) ON DELETE CASCADE,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

CREATE TABLE IF NOT EXISTS wholesale_partner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id TEXT NOT NULL REFERENCES wholesale_partners(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wholesale_orders_partner_created ON wholesale_orders(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wholesale_orders_status_created ON wholesale_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wholesale_orders_number ON wholesale_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_wholesale_items_order ON wholesale_order_items(order_id, line_number);
CREATE INDEX IF NOT EXISTS idx_wholesale_events_order ON wholesale_order_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wholesale_partner_events_partner ON wholesale_partner_events(partner_id, created_at DESC);
