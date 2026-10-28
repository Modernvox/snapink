export const WHOLESALE_PRICE_TIERS = Object.freeze([
  { min: 50, max: 99, label: "50–99 sleeves", sizes03: 350, sizes46: 400 },
  { min: 100, max: 199, label: "100–199 sleeves", sizes03: 300, sizes46: 350 },
  { min: 200, max: 499, label: "200–499 sleeves", sizes03: 250, sizes46: 300 },
  { min: 500, max: null, label: "500+ sleeves", sizes03: 200, sizes46: 250 },
]);

export const CUSTOM_WHOLESALE_PRICE_TIERS = Object.freeze([
  { min: 20, max: 49, label: "20–49 custom sleeves", unitPriceCents: 1000 },
  { min: 50, max: null, label: "50+ custom sleeves", unitPriceCents: 800 },
]);

export const WHOLESALE_LEAD_TIMES = Object.freeze([
  { min: 50, max: 100, code: "3_4_business_days", label: "3–4 business days" },
  { min: 101, max: 200, code: "to_be_confirmed", label: "Lead time to be confirmed" },
  { min: 201, max: null, code: "approximately_2_weeks", label: "Approximately 2 weeks" },
]);

export const WHOLESALE_STATUSES = Object.freeze([
  "pending_review",
  "awaiting_artwork_approval",
  "approved_awaiting_payment",
  "scheduled_for_production",
  "in_production",
  "ready_to_ship",
  "shipped",
  "completed",
  "cancelled",
]);

export const WHOLESALE_STATUS_LABELS = Object.freeze({
  pending_review: "Pending Review",
  awaiting_artwork_approval: "Awaiting Artwork Approval",
  approved_awaiting_payment: "Approved / Awaiting Payment Arrangement",
  scheduled_for_production: "Scheduled for Production",
  in_production: "In Production",
  ready_to_ship: "Ready to Ship",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
});

// No manufacturing-approved wholesale design catalog is currently registered.
// Add entries only after the owner approves an orderable design and its reference.
export const APPROVED_WHOLESALE_DESIGNS = Object.freeze([]);

export function wholesaleTierFor(totalQuantity) {
  if (!Number.isInteger(totalQuantity) || totalQuantity < 50) return null;
  return WHOLESALE_PRICE_TIERS.find((tier) => totalQuantity >= tier.min && (tier.max == null || totalQuantity <= tier.max)) || null;
}

export function customWholesaleTierFor(totalQuantity) {
  if (!Number.isInteger(totalQuantity) || totalQuantity < 20) return null;
  return CUSTOM_WHOLESALE_PRICE_TIERS.find((tier) => totalQuantity >= tier.min && (tier.max == null || totalQuantity <= tier.max)) || null;
}

export function leadTimeFor(totalQuantity) {
  if (!Number.isInteger(totalQuantity) || totalQuantity < 50) return null;
  return WHOLESALE_LEAD_TIMES.find((lead) => totalQuantity >= lead.min && (lead.max == null || totalQuantity <= lead.max)) || null;
}

export function priceWholesaleLines(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 50) return { error: "Add between 1 and 50 order line items." };
  let totalQuantity = 0, blankQuantity = 0, customQuantity = 0;
  for (const line of lines) {
    if (!line || !Number.isInteger(line.size) || line.size < 0 || line.size > 6) return { error: "Sleeve sizes must be whole numbers from 0 through 6." };
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000) return { error: "Each line quantity must be a whole number from 1 through 10,000." };
    if (line.designType === "blank") blankQuantity += line.quantity;
    else if (line.designType === "custom_branding" || line.designType === "approved_design") customQuantity += line.quantity;
    else return { error: "Each line must be classified as blank or custom." };
    totalQuantity += line.quantity;
    if (totalQuantity > 10000) return { error: "The maximum request quantity is 10,000 sleeves." };
  }
  if (blankQuantity > 0 && blankQuantity < 50) return { error: "Blank sleeve lines require at least 50 blanks per order." };
  if (customQuantity > 0 && customQuantity < 20) return { error: "Custom sleeve lines require at least 20 custom sleeves per order." };
  const blankTier = blankQuantity ? wholesaleTierFor(blankQuantity) : null;
  const customTier = customQuantity ? customWholesaleTierFor(customQuantity) : null;
  const tierLabel = [blankTier && `Blank ${blankTier.label}`, customTier && `Custom ${customTier.label}`].filter(Boolean).join(" · ");
  const leadTime = leadTimeFor(totalQuantity);
  const pricedLines = lines.map((line) => {
    const unitPriceCents = line.designType === "blank"
      ? (line.size <= 3 ? blankTier.sizes03 : blankTier.sizes46)
      : customTier.unitPriceCents;
    return { ...line, unitPriceCents, subtotalCents: unitPriceCents * line.quantity };
  });
  const blankSubtotalCents = pricedLines.filter((line) => line.designType === "blank").reduce((sum, line) => sum + line.subtotalCents, 0);
  const customSubtotalCents = pricedLines.filter((line) => line.designType !== "blank").reduce((sum, line) => sum + line.subtotalCents, 0);
  const subtotalCents = blankSubtotalCents + customSubtotalCents;
  const tier = { label: tierLabel, blank: blankTier && { label: blankTier.label, min: blankTier.min, max: blankTier.max }, custom: customTier && { label: customTier.label, min: customTier.min, max: customTier.max } };
  return { totalQuantity, blankQuantity, customQuantity, blankSubtotalCents, customSubtotalCents, tier, leadTime, lines: pricedLines, subtotalCents, currency: "USD" };
}
