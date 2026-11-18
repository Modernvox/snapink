-- Normalize saved product names while keeping product IDs, slugs, and all
-- non-title catalog data unchanged.
UPDATE shop_products
SET name = trim(trim(
  replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(name,
      ' Swappable Snapback Hat Strap – SnapInk Sleeve™', ''),
      ' – Swappable Snapback Hat Strap – SnapInk Sleeve™', ''),
      ' Swappable Snapback Hat Strap – SnapInk SleeveTM', ''),
      ' – Swappable Snapback Hat Strap – SnapInk SleeveTM', ''),
      ' SnapInk SleeveTM', ''),
      ' – SnapInk SleeveTM', ''),
      ' SnapInk Sleeve™', ''),
    char(173), ''), char(8203), ''), char(8204), ''), char(8205), '')),
  ' –—-') || ' Swappable Snapback Hat Strap – SnapInk Sleeve™');
