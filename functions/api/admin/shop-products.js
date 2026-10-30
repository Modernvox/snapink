import {bearer,json,now} from "../../_lib/orders.js";
import {readShopProducts} from "../../_lib/shop.js";

export async function onRequestGet({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop catalog storage is unavailable."},503);
  try{return json({products:await readShopProducts(env.DB,{includeInactive:true})})}
  catch(error){console.error("Admin Shop product load failed",error instanceof Error?error.message:"unknown");return json({error:"Shop product catalog is not initialized. Apply migration 0012."},503)}
}

export async function onRequestPatch({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop catalog storage is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({error:"Invalid product update."},400)}
  if(typeof body.productId!=="string")return json({error:"Choose a valid product."},400);
  try{
    const product=await env.DB.prepare("SELECT product_id FROM shop_products WHERE product_id=?").bind(body.productId).first();if(!product)return json({error:"Shop product not found."},404);
    const time=now();
    if(body.active!==undefined){if(typeof body.active!=="boolean")return json({error:"Product activation must be true or false."},400);await env.DB.prepare("UPDATE shop_products SET active=?,updated_at=? WHERE product_id=?").bind(body.active?1:0,time,body.productId).run()}
    if(body.prices!==undefined){
      if(!Array.isArray(body.prices)||body.prices.length!==6||body.prices.some((value)=>!Number.isSafeInteger(value)||value<1||value>100000))return json({error:"Enter six valid USD prices in cents."},400);
      // The approved size-based schedule is shared by all exclusive designs.
      // Keeping it synchronized prevents LIFT and THREE STAR from drifting apart.
      await env.DB.prepare("UPDATE shop_products SET prices_json=?,updated_at=?").bind(JSON.stringify(body.prices),time).run();
    }
    if(body.variantId!==undefined){
      if(typeof body.variantId!=="string")return json({error:"Choose a valid product variant."},400);
      const variant=await env.DB.prepare("SELECT variant_id FROM shop_product_variants WHERE product_id=? AND variant_id=?").bind(body.productId,body.variantId).first();if(!variant)return json({error:"Product variant not found."},404);
      if(body.variantActive!==undefined){if(typeof body.variantActive!=="boolean")return json({error:"Variant activation must be true or false."},400);await env.DB.prepare("UPDATE shop_product_variants SET active=? WHERE product_id=? AND variant_id=?").bind(body.variantActive?1:0,body.productId,body.variantId).run()}
      if(body.availableSizes!==undefined){if(!Array.isArray(body.availableSizes)||body.availableSizes.some((size)=>!Number.isInteger(size)||size<0||size>5))return json({error:"Choose available sizes from 0 through 5."},400);await env.DB.prepare("UPDATE shop_product_variants SET available_sizes_json=? WHERE product_id=? AND variant_id=?").bind(JSON.stringify([...new Set(body.availableSizes)].sort()),body.productId,body.variantId).run()}
    }
    if(body.inventory!==undefined){if(!Array.isArray(body.inventory)||body.inventory.length>6)return json({error:"Inventory updates are invalid."},400);for(const stock of body.inventory){if(typeof stock.variantId!=="string"||!Number.isInteger(stock.size)||stock.size<0||stock.size>5||(stock.quantity!==null&&(!Number.isSafeInteger(stock.quantity)||stock.quantity<0||stock.quantity>100000)))return json({error:"Set a valid inventory quantity for each sleeve size."},400);if(stock.quantity===null)await env.DB.prepare("DELETE FROM shop_inventory WHERE product_id=? AND variant_id=? AND size=?").bind(body.productId,stock.variantId,stock.size).run();else {const result=await env.DB.prepare(`INSERT INTO shop_inventory(product_id,variant_id,size,available_quantity,reserved_quantity,updated_at) VALUES(?,?,?,?,0,?)
          ON CONFLICT(product_id,variant_id,size) DO UPDATE SET available_quantity=excluded.available_quantity,updated_at=excluded.updated_at WHERE shop_inventory.reserved_quantity<=excluded.available_quantity`).bind(body.productId,stock.variantId,stock.size,stock.quantity,time).run();if(!result.meta?.changes)return json({error:`Size ${stock.size} inventory cannot be reduced below the quantity reserved by active checkouts.`},409)}}}
    return json({ok:true,products:await readShopProducts(env.DB,{includeInactive:true})});
  }catch(error){console.error("Admin Shop product update failed",error instanceof Error?error.message:"unknown");return json({error:error instanceof Error?error.message:"Could not save the product configuration."},503)}
}
