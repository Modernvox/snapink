CREATE TABLE IF NOT EXISTS shop_product_galleries (
  product_id TEXT PRIMARY KEY REFERENCES shop_products(product_id) ON DELETE CASCADE,
  gallery_json TEXT NOT NULL
);
