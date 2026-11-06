import { json } from "../../_lib/orders.js";
import { readShopCategories } from "../../_lib/shop.js";

export async function onRequestGet({env}) {
  if(!env.DB)return json({error:"The Shop catalog is temporarily unavailable."},503);
  try{return json({categories:await readShopCategories(env.DB)})}
  catch(error){console.error("Shop categories read failed",error instanceof Error?error.message:"unknown");return json({error:"Shop categories are temporarily unavailable."},503)}
}
