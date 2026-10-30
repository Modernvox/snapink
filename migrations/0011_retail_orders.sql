CREATE TABLE IF NOT EXISTS retail_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  shipping_address_json TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  variant TEXT NOT NULL CHECK (variant IN ('standard','billboard')),
  size INTEGER NOT NULL CHECK (size BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','CHANGES_REQUESTED','DECLINED','APPROVED','AWAITING_PAYMENT','PAID','IN_PRODUCTION','SHIPPED','COMPLETED')),
  draft_json TEXT NOT NULL,
  artwork_key TEXT NOT NULL,
  artwork_sha256 TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  preview_sha256 TEXT NOT NULL,
  source_artwork_key TEXT,
  source_artwork_sha256 TEXT,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  merchandise_subtotal_cents INTEGER NOT NULL CHECK (merchandise_subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  total_before_tax_cents INTEGER NOT NULL CHECK (total_before_tax_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_paid_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  owner_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (owner_email_status IN ('pending','sent','failed')),
  customer_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (customer_email_status IN ('pending','sent','failed')),
  payment_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_email_status IN ('pending','sending','sent','failed')),
  owner_payment_notice_status TEXT NOT NULL DEFAULT 'pending' CHECK (owner_payment_notice_status IN ('pending','sending','sent','failed')),
  payment_confirmation_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_confirmation_status IN ('pending','sending','sent','failed')),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  checkout_url TEXT,
  checkout_expires_at TEXT,
  payment_attempts INTEGER NOT NULL DEFAULT 0 CHECK (payment_attempts >= 0),
  admin_notes TEXT,
  approved_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retail_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES retail_orders(id),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retail_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id TEXT REFERENCES retail_orders(id),
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retail_orders_status_created ON retail_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_orders_customer_email ON retail_orders(customer_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_order_events_order ON retail_order_events(order_id, created_at DESC);
