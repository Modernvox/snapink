-- Put identifiable Studio On-Desk images first for existing products while
-- retaining all image URLs, image files, and product identifiers.
-- D1 blocks TEMP schema objects, so use a migration-scoped regular table and
-- remove it before this migration completes.
CREATE TABLE studio_product_image_priority_stage AS
SELECT product.product_id,
       product.image_url AS previous_image_url,
       product.image_alt AS previous_image_alt,
       (SELECT json_extract(image.value, '$.url')
        FROM shop_product_galleries AS gallery, json_each(gallery.gallery_json) AS image
        WHERE gallery.product_id = product.product_id
          AND replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%on-desk%'
        ORDER BY CAST(image.key AS INTEGER) LIMIT 1) AS desk_image_url
FROM shop_products AS product
WHERE product.product_id LIKE 'studio-%'
  AND EXISTS (
    SELECT 1 FROM shop_product_galleries AS gallery, json_each(gallery.gallery_json) AS image
    WHERE gallery.product_id = product.product_id
      AND replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%on-desk%'
  );

UPDATE shop_product_galleries AS gallery
SET gallery_json = (
  SELECT json_group_array(json(ordered.item))
  FROM (
    SELECT json_object(
      'url', json_extract(image.value, '$.url'),
      'alt', COALESCE(json_extract(image.value, '$.alt'), ''),
      'label', COALESCE(json_extract(image.value, '$.label'), 'Product image')
    ) AS item,
    CASE
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%on-hat%' THEN 0
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%packaging%' THEN 1
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%male-lifestyle%' THEN 2
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%female-lifestyle%' THEN 3
      ELSE 4
    END AS priority,
    CAST(image.key AS INTEGER) AS sequence
    FROM json_each(gallery.gallery_json) AS image
    WHERE replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') NOT LIKE '%on-desk%'
    UNION ALL
    SELECT json_object('url', stage.previous_image_url, 'alt', stage.previous_image_alt, 'label', 'Previous primary image'), 5, 999999
    FROM studio_product_image_priority_stage AS stage
    WHERE stage.product_id = gallery.product_id
    ORDER BY priority, sequence
  ) AS ordered
)
WHERE gallery.product_id LIKE 'studio-%'
  AND gallery.product_id IN (SELECT product_id FROM studio_product_image_priority_stage);

UPDATE shop_products AS product
SET image_url = (SELECT desk_image_url FROM studio_product_image_priority_stage AS stage WHERE stage.product_id = product.product_id),
    image_alt = product.name || ' On-Desk product image',
    updated_at = datetime('now')
WHERE product.product_id LIKE 'studio-%'
  AND product.product_id IN (SELECT product_id FROM studio_product_image_priority_stage);

-- Reorder the remaining labeled Studio views consistently. Unknown existing
-- images retain their relative position after the recognized image types.
UPDATE shop_product_galleries AS gallery
SET gallery_json = (
  SELECT json_group_array(json(ordered.item))
  FROM (
    SELECT json_object(
      'url', json_extract(image.value, '$.url'),
      'alt', COALESCE(json_extract(image.value, '$.alt'), ''),
      'label', COALESCE(json_extract(image.value, '$.label'), 'Product image')
    ) AS item,
    CASE
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%on-hat%' THEN 0
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%packaging%' THEN 1
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%male-lifestyle%' THEN 2
      WHEN replace(lower(COALESCE(json_extract(image.value, '$.label'), '')), '_', '-') LIKE '%female-lifestyle%' THEN 3
      ELSE 4
    END AS priority,
    CAST(image.key AS INTEGER) AS sequence
    FROM json_each(gallery.gallery_json) AS image
    ORDER BY priority, sequence
  ) AS ordered
)
WHERE gallery.product_id LIKE 'studio-%';

DROP TABLE studio_product_image_priority_stage;
