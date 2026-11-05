-- Smooth a few imported design sentences after the earlier terminology swap.
UPDATE shop_products
SET description = replace(
      replace(
        replace(description,
          'transforms the visible strap on your existing snapback closure of your backward-worn snapback into',
          'adds a customizable surface to the back of your backward-worn snapback as'),
        'transforms the visible strap on your existing snapback closure of your favorite backward-worn snapback into',
        'adds a customizable surface to the back of your favorite backward-worn snapback as'),
      'transforms the visible strap on your existing snapback closure of your backward-worn hat into',
      'adds customizable lettering to the back of your backward-worn hat, creating'),
    updated_at = datetime('now')
WHERE active = 1;
