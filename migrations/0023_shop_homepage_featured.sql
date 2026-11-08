ALTER TABLE shop_products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1));
CREATE INDEX shop_products_featured_active_idx ON shop_products(featured,active);
