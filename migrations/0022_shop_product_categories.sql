CREATE TABLE IF NOT EXISTS shop_product_categories (
  category_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE shop_products ADD COLUMN category_id TEXT REFERENCES shop_product_categories(category_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS shop_products_category_id_idx ON shop_products(category_id);

INSERT OR IGNORE INTO shop_product_categories(category_id,name,slug,sort_order,active,created_at,updated_at) VALUES
  ('cat_streetwear_slang','Streetwear & Slang','streetwear-slang',0,1,datetime('now'),datetime('now')),
  ('cat_cities_states','Cities & States','cities-states',1,1,datetime('now'),datetime('now')),
  ('cat_motivation_mindset','Motivation & Mindset','motivation-mindset',2,1,datetime('now'),datetime('now')),
  ('cat_lifestyle_identity','Lifestyle & Identity','lifestyle-identity',3,1,datetime('now'),datetime('now')),
  ('cat_sports_fan_culture','Sports & Fan Culture','sports-fan-culture',4,1,datetime('now'),datetime('now')),
  ('cat_custom_designs','Custom Designs','custom-designs',5,1,datetime('now'),datetime('now'));
