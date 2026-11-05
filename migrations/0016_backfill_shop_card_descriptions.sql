UPDATE shop_products
SET card_description = CASE lower(trim(name))
  WHEN 'brooklyn snapback strap sleeve' THEN 'Brooklyn artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
  WHEN 'hustle snapback strap sleeve' THEN 'HUSTLE artwork adds a bold, interchangeable accent to compatible snapbacks.'
  WHEN 'new york snapback strap sleeve' THEN 'New York artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
  WHEN 'off grid snapback strap sleeve' THEN 'OFF GRID artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
  WHEN 'unc snapback strap sleeve' THEN 'UNC artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
  WHEN 'unc snapback hat strap sleeve by snapink' THEN 'UNC artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
  WHEN 'california_logo' THEN 'California artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
  WHEN 'wide open snapback hat strap sleeve/cover' THEN 'WIDE OPEN artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
  ELSE trim(name) || ' artwork adds a distinctive, interchangeable accent to compatible snapbacks.'
END
WHERE trim(card_description) = '' AND length(trim(description)) > 160;
