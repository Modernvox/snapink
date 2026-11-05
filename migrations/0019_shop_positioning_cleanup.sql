-- Clean up wording left behind by older product copy while preserving each
-- listing's design-specific description and all catalog configuration.
UPDATE shop_products
SET description = trim(
      replace(
        replace(
          replace(
            replace(description,
              'transforms the visible strap on your existing snapback closure of your backward-worn snapback',
              'adds a customizable surface to your backward-worn snapback'),
            'transforms the visible strap on your existing snapback closure into',
            'adds a customizable surface to'),
          'subject to production review', ''),
        'Ships within 24–48 hours after production approval.', '')),
    card_description = replace(
      card_description,
      ' A premium swappable snapback hat strap design that changes your look without changing hats.',
      ' A premium swappable snapback hat strap by SnapInk.'),
    updated_at = datetime('now')
WHERE active = 1;
