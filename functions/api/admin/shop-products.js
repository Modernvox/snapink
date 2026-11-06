import {bearer,json,now} from "../../_lib/orders.js";
import {PREMIUM_EXTENDED_SHOP_PRICES, readShopProducts, readStandardShopPrices, removeExtendedArtworkCopy} from "../../_lib/shop.js";

function isPublicProductImagePath(value){
  if(typeof value!=="string"||value!==value.trim()||value.length<1||value.length>500||/[\u0000-\u001f\\]/.test(value))return false;
  let decoded;try{decoded=decodeURIComponent(value)}catch{return false}
  if(!decoded.startsWith("/images/product_images/"))return false;
  const parts=decoded.split("/");if(parts.some((part)=>part==="."||part===".."))return false;
  return /\.(png|jpe?g|webp|avif)$/i.test(decoded);
}

function galleryImages(value){
  let gallery=value;for(let depth=0;depth<2&&typeof gallery==="string";depth++){try{gallery=JSON.parse(gallery)}catch{return[]}}
  return Array.isArray(gallery)?gallery.filter((image)=>image&&typeof image==="object"&&typeof image.url==="string").map((image)=>image.url):[];
}

function storedProductImageKey(value){
  if(typeof value!=="string"||!value)return null;
  try{const url=new URL(value,"https://snapink.invalid");if(url.pathname!=="/api/shop/product-image")return null;const key=url.searchParams.get("key")||"";return /^shop-products\/[A-Za-z0-9_-]{1,100}\/(?:[1-5]|on-hat|packaging|on-desk)\.png$/.test(key)?key:null}catch{return null}
}

function imageKeysFromReferences(references){
  const keys=new Set();for(const reference of references){const key=storedProductImageKey(reference);if(key){keys.add(key);keys.add(key.replace(/\.png$/,"-thumb.webp"))}}return keys;
}

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
    const product=await env.DB.prepare("SELECT product_id AS productId,image_url AS imageUrl,image_alt AS imageAlt,description,card_description AS cardDescription,artwork_tier AS artworkTier,category_id AS categoryId FROM shop_products WHERE product_id=?").bind(body.productId).first();if(!product)return json({error:"Shop product not found."},404);
    if(body.artworkTier!==undefined&&!["standard","premium"].includes(body.artworkTier))return json({error:"Choose Standard or Premium Extended Artwork."},400);
    // Legacy products can retain a previously published image path that no
    // longer meets the current image upload rules. Allow status-only admin
    // changes to keep that image unchanged; validate any replacement path.
    if(body.imageUrl!==undefined&&body.imageUrl!==product.imageUrl&&!isPublicProductImagePath(body.imageUrl))return json({error:"Choose an image under /images/product_images/ with a supported image extension."},400);
    if(body.imageAlt!==undefined&&(typeof body.imageAlt!=="string"||!body.imageAlt.trim()||body.imageAlt.length>300))return json({error:"Enter descriptive image alt text up to 300 characters."},400);
    const time=now();
    if(body.active!==undefined){if(typeof body.active!=="boolean")return json({error:"Product activation must be true or false."},400);await env.DB.prepare("UPDATE shop_products SET active=?,updated_at=? WHERE product_id=?").bind(body.active?1:0,time,body.productId).run()}
    if(body.categoryId!==undefined){
      if(body.categoryId!==null&&typeof body.categoryId!=="string")return json({error:"Choose a valid product category."},400);
      if(body.categoryId!==null){const category=await env.DB.prepare("SELECT category_id FROM shop_product_categories WHERE category_id=?").bind(body.categoryId).first();if(!category)return json({error:"Shop category not found."},404)}
      await env.DB.prepare("UPDATE shop_products SET category_id=?,updated_at=? WHERE product_id=?").bind(body.categoryId,time,body.productId).run();
    }
    if(body.imageUrl!==undefined||body.imageAlt!==undefined){
      await env.DB.prepare("UPDATE shop_products SET image_url=?,image_alt=?,updated_at=? WHERE product_id=?").bind(body.imageUrl??product.imageUrl,body.imageAlt?.trim()??product.imageAlt,time,body.productId).run();
    }
    if(body.artworkTier!==undefined){
      const premium=body.artworkTier==="premium",prices=premium?PREMIUM_EXTENDED_SHOP_PRICES:await readStandardShopPrices(env.DB,body.productId);
      let description=premium?product.description:removeExtendedArtworkCopy(product.description);
      const cardDescription=premium?product.cardDescription:removeExtendedArtworkCopy(product.cardDescription);
      if(premium&&!/extended artwork pricing/i.test(description))description=`${description}\n\nExtended artwork pricing: sizes 0–2 $24.99; sizes 3–5 $29.99. Final production feasibility will be confirmed during design review.`;
      await env.DB.prepare("UPDATE shop_products SET artwork_tier=?,prices_json=?,description=?,card_description=?,updated_at=? WHERE product_id=?")
        .bind(body.artworkTier,JSON.stringify(prices),description,cardDescription,time,body.productId).run();
    }
    if(body.prices!==undefined){
      if(!Array.isArray(body.prices)||body.prices.length!==6||body.prices.some((value)=>!Number.isSafeInteger(value)||value<1||value>100000))return json({error:"Enter six valid USD prices in cents."},400);
      if(product.artworkTier!=="standard")return json({error:"Global Shop pricing applies to Standard products. Resolve the artwork tier before editing this product's pricing."},409);
      await env.DB.prepare("UPDATE shop_products SET prices_json=?,updated_at=? WHERE artwork_tier='standard'").bind(JSON.stringify(body.prices),time).run();
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

export async function onRequestDelete({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop catalog storage is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({error:"Choose a valid product to delete."},400)}
  if(typeof body.productId!=="string"||!body.productId.trim()||body.productId.length>100)return json({error:"Choose a valid product to delete."},400);
  const productId=body.productId.trim();
  try{
    const product=await env.DB.prepare("SELECT product_id AS productId,name,image_url AS imageUrl FROM shop_products WHERE product_id=?").bind(productId).first();
    if(!product)return json({error:"Shop product not found."},404);
    const gallery=await env.DB.prepare("SELECT gallery_json AS galleryJson FROM shop_product_galleries WHERE product_id=?").bind(productId).first().catch(()=>null);
    const variants=await env.DB.prepare("SELECT sleeve_image_url AS sleeveImageUrl FROM shop_product_variants WHERE product_id=?").bind(productId).all();
    const productReferences=[product.imageUrl,...galleryImages(gallery?.galleryJson),...(variants.results||[]).map((row)=>row.sleeveImageUrl)];
    const productKeys=imageKeysFromReferences(productReferences);
    // This product's image directory is scoped to its immutable product ID.
    const ownPrefix=`shop-products/${productId}/`;
    const ownedKeys=[...productKeys].filter((key)=>key.startsWith(ownPrefix));

    await env.DB.batch([
      env.DB.prepare("DELETE FROM shop_inventory WHERE product_id=?").bind(productId),
      env.DB.prepare("DELETE FROM shop_product_galleries WHERE product_id=?").bind(productId),
      env.DB.prepare("DELETE FROM shop_product_variants WHERE product_id=?").bind(productId),
      env.DB.prepare("DELETE FROM shop_products WHERE product_id=?").bind(productId),
    ]);

    let cleanupWarning="";let deletedImageCount=0;
    if(ownedKeys.length){
      try{
        const [products,galleries,variantImages]=await Promise.all([
          env.DB.prepare("SELECT image_url AS imageUrl FROM shop_products").all(),
          env.DB.prepare("SELECT gallery_json AS galleryJson FROM shop_product_galleries").all(),
          env.DB.prepare("SELECT sleeve_image_url AS sleeveImageUrl FROM shop_product_variants WHERE sleeve_image_url IS NOT NULL").all(),
        ]);
        const references=[...(products.results||[]).map((row)=>row.imageUrl),...(galleries.results||[]).flatMap((row)=>galleryImages(row.galleryJson)),...(variantImages.results||[]).map((row)=>row.sleeveImageUrl)];
        const stillReferenced=imageKeysFromReferences(references);
        const safeToDelete=ownedKeys.filter((key)=>!stillReferenced.has(key));
        if(env.PRIVATE_ASSETS){for(const key of safeToDelete){await env.PRIVATE_ASSETS.delete(key);deletedImageCount++;}}
        else cleanupWarning="Product was deleted, but stored image cleanup is unavailable.";
      }catch(error){console.error("Deleted Shop product image cleanup failed",error instanceof Error?error.message:"unknown");cleanupWarning="Product was deleted, but one or more stored images could not be removed.";}
    }
    return json({ok:true,productId,productName:product.name,deletedImageCount,cleanupWarning});
  }catch(error){console.error("Admin Shop product delete failed",error instanceof Error?error.message:"unknown");return json({error:"Could not delete the product. No product changes were confirmed."},503)}
}
