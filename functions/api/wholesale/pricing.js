import { json } from "../../_lib/orders.js";
import { CUSTOM_WHOLESALE_PRICE_TIERS, WHOLESALE_LEAD_TIMES, WHOLESALE_PRICE_TIERS } from "../../_lib/wholesale.js";
import { partnerUnauthorized, wholesalePartnerFor } from "../../_lib/wholesale-auth.js";

export async function onRequestGet({ request, env }){
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  return json({currency:"USD",minimumQuantity:50,customMinimumQuantity:20,tiers:WHOLESALE_PRICE_TIERS,blankTiers:WHOLESALE_PRICE_TIERS,customTiers:CUSTOM_WHOLESALE_PRICE_TIERS,leadTimes:WHOLESALE_LEAD_TIMES});
}
