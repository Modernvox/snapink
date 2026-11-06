import { json } from "../../_lib/orders.js";
import { readShopCategories } from "../../_lib/shop.js";

export async function onRequestGet({env}) {
  if(!env.DB)return json({error:"The Shop catalog is temporarily unavailable."},503);
  try{return json({categories:await readShopCategories(env.DB)})}
  catch(error){
    const message=error instanceof Error?error.message:"unknown";
    console.error("Shop categories read failed",message);
    const migrationMissing=/no such table:\s*shop_product_categories/i.test(message);
    return json({error:migrationMissing?"Shop categories are not initialized yet. Apply D1 migration 0022_shop_product_categories.sql, then reload Studio.":"Shop categories could not be loaded from the catalog. Refresh the page; if the problem continues, contact the SnapInk administrator."},503);
  }
}
