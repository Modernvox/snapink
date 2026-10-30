export function stripeAutomaticTaxEnabled(env) {
  return env.STRIPE_AUTOMATIC_TAX_ENABLED === "true";
}

export function stripeSessionTax(session, expectedEnabled = null) {
  const rawAmount = session?.total_details?.amount_tax;
  const taxCents = rawAmount == null ? 0 : Number(rawAmount);
  if (!Number.isSafeInteger(taxCents) || taxCents < 0) return null;

  const enabled = session?.automatic_tax?.enabled === true;
  if (expectedEnabled !== null && enabled !== expectedEnabled) return null;
  if (enabled && session?.automatic_tax?.status !== "complete") return null;
  if (!enabled && taxCents !== 0) return null;

  return { enabled, taxCents };
}
