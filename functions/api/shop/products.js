import { json } from "../../_lib/orders.js";
import { readShopProducts, publicShopProduct } from "../../_lib/shop.js";

export async function onRequestGet({env}) {
  if (!env.DB) return json({error:"The exclusive shop catalog is temporarily unavailable."},503);
  try {
    const products=await readShopProducts(env.DB);
    return json({products:products.map(publicShopProduct),currency:"usd"});
  } catch(error) {
    console.error("Shop product catalog read failed",error instanceof Error?error.message:"unknown");
    return json({error:"The exclusive shop catalog is temporarily unavailable."},503);
  }
}
