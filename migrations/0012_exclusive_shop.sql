CREATE TABLE IF NOT EXISTS shop_products (
  product_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_alt TEXT NOT NULL,
  prices_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_product_variants (
  product_id TEXT NOT NULL REFERENCES shop_products(product_id),
  variant_id TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  sleeve_color TEXT NOT NULL,
  artwork_color TEXT NOT NULL,
  available_sizes_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (product_id, variant_id)
);

-- A missing row means inventory is not tracked for that variant and size.
CREATE TABLE IF NOT EXISTS shop_inventory (
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size BETWEEN 0 AND 5),
  available_quantity INTEGER NOT NULL CHECK (available_quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, variant_id, size),
  FOREIGN KEY (product_id, variant_id) REFERENCES shop_product_variants(product_id, variant_id)
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  shipping_address_json TEXT NOT NULL,
  items_json TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  merchandise_subtotal_cents INTEGER NOT NULL CHECK (merchandise_subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_paid_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  status TEXT NOT NULL DEFAULT 'CHECKOUT_PENDING' CHECK (status IN ('CHECKOUT_PENDING','AWAITING_PAYMENT','PAID','IN_PRODUCTION','SHIPPED','COMPLETED','CANCELLED','EXPIRED')),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  checkout_url TEXT,
  tracking_number TEXT,
  carrier TEXT,
  admin_notes TEXT,
  customer_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (customer_email_status IN ('pending','sent','failed')),
  owner_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (owner_email_status IN ('pending','sent','failed')),
  payment_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_email_status IN ('pending','sent','failed')),
  payment_owner_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_owner_email_status IN ('pending','sent','failed')),
  fulfillment_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (fulfillment_email_status IN ('pending','sent','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS shop_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES shop_orders(id),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id TEXT REFERENCES shop_orders(id),
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_status_created ON shop_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_orders_customer_email ON shop_orders(customer_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_events_order ON shop_order_events(order_id, created_at DESC);

INSERT OR IGNORE INTO shop_products(product_id,slug,name,description,image_url,image_alt,prices_json,active,created_at,updated_at) VALUES
('lift','lift','LIFT','A clean, raised LIFT statement for the back of your snapback.','/images/product_images/lift_sleeve_on%20_snapback.png','Black snapback with a black SnapInk sleeve featuring raised white LIFT lettering','[1599,1599,1599,1599,1899,1899]',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('three-star','three-star','THREE STAR','Three raised white stars in the approved SnapInk arrangement.','/images/product_images/three_star_sleeve_on_snapback.png','Black snapback with a black SnapInk sleeve featuring three raised white stars','[1599,1599,1599,1599,1899,1899]',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO shop_product_variants(product_id,variant_id,variant_name,sleeve_color,artwork_color,available_sizes_json,active) VALUES
('lift','black-white','Black sleeve / white artwork','Black','White','[0,1,2,3,4,5]',1),
('three-star','black-white','Black sleeve / white stars','Black','White','[0,1,2,3,4,5]',1);
