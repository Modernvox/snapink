ALTER TABLE shop_products ADD COLUMN artwork_tier TEXT NOT NULL DEFAULT 'review'
  CHECK (artwork_tier IN ('standard','premium','review'));
ALTER TABLE shop_products ADD COLUMN production_metadata_json TEXT NOT NULL DEFAULT '{}';

-- Older Studio publications did not persist the administrator's tier choice.
-- Keep rows with conflicting premium signals for an explicit admin decision.
UPDATE shop_products
SET artwork_tier='standard'
WHERE product_id NOT LIKE 'studio-%';

UPDATE shop_products
SET artwork_tier='standard'
WHERE product_id LIKE 'studio-%'
  AND prices_json='[1599,1599,1599,1599,1899,1899]'
  AND lower(description) NOT LIKE '%extended artwork%'
  AND lower(card_description) NOT LIKE '%extended artwork%';
