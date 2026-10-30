ALTER TABLE shop_product_variants ADD COLUMN sleeve_image_url TEXT;
ALTER TABLE shop_product_variants ADD COLUMN sleeve_image_alt TEXT;

UPDATE shop_product_variants
SET sleeve_image_url='/images/product_images/custom_sleeves/Photo%20Oct%2027%202026,%209%2021%2022%20AM.png',
    sleeve_image_alt='SnapInk LIFT Sleeve only, with raised white LIFT lettering; hat not included'
WHERE product_id='lift' AND variant_id='black-white';

UPDATE shop_product_variants
SET sleeve_image_url='/images/product_images/custom_sleeves/three_star_sleeve.png',
    sleeve_image_alt='SnapInk THREE STAR Sleeve only, with three raised white stars; hat not included'
WHERE product_id='three-star' AND variant_id='black-white';
