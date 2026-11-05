-- Reposition existing published Shop products while preserving their IDs,
-- URLs, images, variants, inventory, production metadata, and price records.
UPDATE shop_products
SET name = trim(substr(name, 1, instr(name, ' Snapback Hat Strap Sleeve – Swappable Cover') - 1))
    || ' Swappable Snapback Hat Strap – SnapInk Sleeve™',
    description = trim(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(description,
                    'SnapInk Strap Sleeve™', 'SnapInk Sleeve™'),
                  'SnapInk Strap Sleeve', 'SnapInk Sleeve™'),
                'snapback strap sleeve', 'swappable snapback hat strap'),
              'Snapback Hat Strap Sleeve', 'Swappable Snapback Hat Strap'),
            'the exposed plastic closure', 'the visible strap on your existing snapback closure'),
          'Final production feasibility will be confirmed during design review.', ''),
        'Extended artwork is subject to production approval.', '')
      || CASE WHEN instr(lower(description), 'flexible tpu sleeve slides over the existing plastic snapback strap') > 0 THEN ''
          ELSE char(10) || char(10) || 'The flexible TPU SnapInk Sleeve™ slides over your existing plastic snapback strap and snaps securely into place, becoming the visible, customizable strap surface. It works with the original snapback closure and does not replace it.' END),
    card_description = trim(card_description)
      || CASE WHEN instr(lower(card_description), 'swappable snapback hat strap') > 0 THEN ''
          ELSE ' A premium swappable snapback hat strap design that changes your look without changing hats.' END,
    image_alt = replace(image_alt, 'Snapback Hat Strap Sleeve – Swappable Cover', 'Swappable Snapback Hat Strap – SnapInk Sleeve™'),
    updated_at = datetime('now')
WHERE active = 1
  AND instr(name, ' Snapback Hat Strap Sleeve – Swappable Cover') > 0;
