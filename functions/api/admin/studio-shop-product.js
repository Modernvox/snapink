import { bearer, json, now } from "../../_lib/orders.js";
import { PREMIUM_EXTENDED_SHOP_PRICES, readStandardShopPrices, removeExtendedArtworkCopy, SHOP_SIZE_IDS, shopCheckoutProductError, shopProductImageRank, shopProductImageType } from "../../_lib/shop.js";
import { canonicalShopProductName } from "../../_lib/shop-product-name.js";
import { MAX_ARTWORK_EXTENSION_PER_EDGE_MM, MAX_EXTENDED_ARTWORK_HEIGHT_MM, artworkHeightExceedsMaximum, artworkProductionReviewReason } from "../../_lib/artwork-limits.js";

const defaultCardDescription = (name) => `${name} is a premium swappable snapback hat strap featuring custom artwork on a SnapInk Sleeve™.`;
const defaultDescription = (name) => `${name} brings custom artwork and a distinctive SnapInk detail to your snapback. The flexible TPU SnapInk Sleeve™ slides over the existing plastic snapback strap, snaps securely into place, and becomes the visible, customizable strap surface. It works with the original snapback closure and does not replace it. Sleeve only; hat sold separately.`;
const cleanCardDescription = (value) => String(value||"").replace(/!\[([^\]]*)\]\([^)]+\)/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/<[^>]*>/g,"").replace(/^\s*(?:[-*+]|\d+\.)\s+/gm,"").replace(/[`*_~>#]/g,"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim();
const safeSlug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70).replace(/-+$/g,"");
const productImageTypeLabel = (file) => ({"on-hat":"On-Hat Product Image","snapback-360":"Snapback 360 Product Image","on-desk":"On-Desk Product Image","female-lifestyle":"Female Lifestyle Image","male-lifestyle":"Male Lifestyle Image",packaging:"Packaging Image"}[shopProductImageType(file)]||"Product Image");

export async function onRequestGet({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  return json({ok:true});
}

export async function onRequestPost({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN)) return json({error:"Unauthorized"},401);
  if(!env.DB||!env.PRIVATE_ASSETS) return json({error:"Shop storage is unavailable. Confirm the shop database and private asset bucket are configured."},503);
  let form; try { form=await request.formData(); } catch { return json({error:"Product details or images are invalid."},400); }
  const name=canonicalShopProductName(form.get("name"));
  const categoryId=String(form.get("categoryId")||"").trim();
  let cardDescription=cleanCardDescription(form.get("cardDescription"))||defaultCardDescription(name);
  let description=String(form.get("description")||"").trim()||defaultDescription(name);
  const style=String(form.get("style")||""), color=String(form.get("color")||"").trim();
  const artworkTier=String(form.get("artworkTier")||"standard");
  if(!["standard","premium"].includes(artworkTier))return json({error:"Choose Standard or Premium Extended Artwork."},400);
  const premiumArtwork=artworkTier==="premium";
  const extensionMm=Number(form.get("artworkExtensionMm")||0), artworkWidthMm=Number(form.get("artworkWidthMm")||0), artworkHeightMm=Number(form.get("artworkHeightMm")||0);
  const artworkStrokeEnabled=String(form.get("artworkStrokeEnabled")||"false")==="true", artworkStrokeWidthMm=Number(form.get("artworkStrokeWidthMm")||1.5), artworkStrokeColor=String(form.get("artworkStrokeColor")||"#000000");
  if(!Number.isFinite(artworkStrokeWidthMm)||artworkStrokeWidthMm<0.25||artworkStrokeWidthMm>5||!/^#[0-9a-f]{6}$/i.test(artworkStrokeColor))return json({error:"Artwork stroke settings are invalid."},400);
  const productionMetadata={size:Number(form.get("artworkSize")),artworkWidthMm,artworkWidthScale:Number(form.get("artworkWidthScale")||100),artworkHeightMm,artworkExtensionMm:extensionMm,artworkTopExtensionMm:Number(form.get("artworkTopExtensionMm")||0),artworkBottomExtensionMm:Number(form.get("artworkBottomExtensionMm")||0),artworkHeightScale:Number(form.get("artworkHeightScale")||100),artworkCenterXmm:Number(form.get("artworkCenterXmm")||0),artworkCenterYmm:Number(form.get("artworkCenterYmm")||0),artworkStrokeEnabled,artworkStrokeWidthMm,artworkStrokeColor};
  const {size,artworkWidthScale,artworkTopExtensionMm,artworkBottomExtensionMm,artworkHeightScale,artworkCenterXmm,artworkCenterYmm}=productionMetadata;
  if (!Number.isInteger(size)||size<0||size>5||![artworkWidthMm,artworkWidthScale,artworkHeightMm,extensionMm,artworkTopExtensionMm,artworkBottomExtensionMm,artworkHeightScale,artworkCenterXmm,artworkCenterYmm].every(Number.isFinite)
    || artworkWidthMm<0 || artworkWidthMm>200 || artworkHeightMm<0 || artworkHeightExceedsMaximum(artworkHeightMm)
    || artworkWidthScale<10 || artworkWidthScale>400
    || extensionMm<0 || extensionMm>MAX_ARTWORK_EXTENSION_PER_EDGE_MM+0.001
    || artworkTopExtensionMm<0 || artworkTopExtensionMm>MAX_ARTWORK_EXTENSION_PER_EDGE_MM+0.001
    || artworkBottomExtensionMm<0 || artworkBottomExtensionMm>MAX_ARTWORK_EXTENSION_PER_EDGE_MM+0.001
    || artworkHeightScale<25
    || Math.abs(extensionMm-Math.max(artworkTopExtensionMm,artworkBottomExtensionMm))>0.001) return json({error:"Artwork measurements exceed the permitted production dimensions."},400);
  const productionReviewReason=artworkProductionReviewReason(artworkWidthMm,artworkHeightMm,artworkCenterXmm,size);
  if(productionReviewReason)return json({error:"Artwork outside verified production dimensions requires manufacturing review before product publication."},409);
  if (premiumArtwork) {
    if (String(form.get("approveExtendedArtwork"))!=="true") return json({error:"Explicit administrator approval is required to publish extended artwork at its premium price."},403);
    if (!extensionMm||!artworkWidthMm||!artworkHeightMm||artworkHeightExceedsMaximum(artworkHeightMm)) return json({error:`Premium Extended Artwork must have valid measurements and a total artwork height of ${MAX_EXTENDED_ARTWORK_HEIGHT_MM.toFixed(1)} mm (1.5 in) or less.`},400);
    if(artworkTopExtensionMm>artworkHeightMm||artworkBottomExtensionMm>artworkHeightMm)return json({error:"Premium Extended Artwork measurements are invalid or exceed the permitted boundaries."},400);
  } else {
    description=removeExtendedArtworkCopy(description);
    cardDescription=removeExtendedArtworkCopy(cardDescription);
  }
  if(!name||name.length>100||!safeSlug(name)||cardDescription.length>240||description.length>2000||!['standard','billboard'].includes(style)||!/^#[0-9a-f]{6}$/i.test(color)) return json({error:"Enter a product name and use the current sleeve style and color."},400);
  if(!categoryId)return json({error:"Choose a product category before publishing."},400);
  const category=await env.DB.prepare("SELECT category_id FROM shop_product_categories WHERE category_id=? AND active=1").bind(categoryId).first().catch(()=>null);
  if(!category)return json({error:"Choose an available Shop category."},400);
  const files=form.getAll("galleryImages").filter(file=>file instanceof File).map((file,index)=>({file,index})).sort((a,b)=>shopProductImageRank(a.file)-shopProductImageRank(b.file)||a.index-b.index).map(({file})=>file);
  if(!files.length||files.length>5||files.some(file=>file.type!=="image/png"||file.size<100||file.size>18*1024*1024))return json({error:"Select at least one valid generated product image for the gallery."},400);
  if(files.some(file=>shopProductImageType(file)==="snapback-360"))return json({error:"Snapback 360 publishing is not enabled. Configure complete-hat pricing and fulfillment separately before publishing."},409);
  const thumbnails=form.getAll("galleryThumbnails").filter(file=>file instanceof File).map((file,index)=>({file,index})).sort((a,b)=>shopProductImageRank(a.file)-shopProductImageRank(b.file)||a.index-b.index).map(({file})=>file);
  if(thumbnails.length&& (thumbnails.length!==files.length||thumbnails.some(file=>file.type!=="image/webp"||file.size<100||file.size>2*1024*1024)))return json({error:"Product image thumbnails are invalid."},400);
  const slug=safeSlug(name);
  const standardPrices=await readStandardShopPrices(env.DB);
  const prices=premiumArtwork?PREMIUM_EXTENDED_SHOP_PRICES:standardPrices;
  const checkoutReadinessError=shopCheckoutProductError({productId:"studio-publish-validation",active:true,prices,variants:[{variantId:"studio",active:true,availableSizes:SHOP_SIZE_IDS}]},{requireEverySize:true});
  if(checkoutReadinessError)return json({error:`Product cannot be published yet: ${checkoutReadinessError}`},400);
  const existing=await env.DB.prepare("SELECT product_id AS productId,slug FROM shop_products WHERE slug=?").bind(slug).first();
  if(existing)return json({ok:true,duplicate:true,product:{productId:existing.productId,slug:existing.slug,url:`/shop/${existing.slug}`}});
  const productId=`studio-${crypto.randomUUID()}`, time=now(), objectKeys=files.map((_,i)=>`shop-products/${productId}/${i+1}.png`),thumbnailKeys=thumbnails.map((_,i)=>`shop-products/${productId}/${i+1}-thumb.webp`),storedKeys=[...objectKeys,...thumbnailKeys];
  try {
    for(let i=0;i<files.length;i++) await env.PRIVATE_ASSETS.put(objectKeys[i],files[i].stream(),{httpMetadata:{contentType:"image/png",cacheControl:"public, max-age=31536000, immutable"}});
    for(let i=0;i<thumbnails.length;i++) await env.PRIVATE_ASSETS.put(thumbnailKeys[i],thumbnails[i].stream(),{httpMetadata:{contentType:"image/webp",cacheControl:"public, max-age=31536000, immutable"}});
    const urls=objectKeys.map(key=>`/api/shop/product-image?key=${encodeURIComponent(key)}`);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shop_products(product_id,slug,name,description,card_description,image_url,image_alt,prices_json,artwork_tier,production_metadata_json,category_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)").bind(productId,slug,name,description,cardDescription,urls[0],`${name} ${productImageTypeLabel(files[0])}`,JSON.stringify(prices),artworkTier,JSON.stringify(productionMetadata),categoryId,time,time),
      env.DB.prepare("INSERT INTO shop_product_variants(product_id,variant_id,variant_name,sleeve_color,artwork_color,available_sizes_json,active) VALUES(?,?,?,?,?,?,1)").bind(productId,"studio",`${style === "billboard" ? "Billboard" : "Standard"} custom design`,color, "Custom",JSON.stringify(SHOP_SIZE_IDS)),
      env.DB.prepare("INSERT INTO shop_product_galleries(product_id,gallery_json) VALUES(?,?)").bind(productId,JSON.stringify(urls.slice(1).map((url,i)=>({url,alt:`${name} ${productImageTypeLabel(files[i+1])}`,label:files[i+1]?.name||`Image ${i+2}`})))),
    ]);
    return json({ok:true,product:{productId,slug,url:`/shop/${slug}`}} ,201);
  } catch(error) {
    for(const key of storedKeys) await env.PRIVATE_ASSETS.delete(key).catch(()=>{});
    const duplicate=await env.DB.prepare("SELECT product_id AS productId,slug FROM shop_products WHERE slug=?").bind(slug).first().catch(()=>null);
    if(duplicate)return json({ok:true,duplicate:true,product:{productId:duplicate.productId,slug:duplicate.slug,url:`/shop/${duplicate.slug}`}});
    console.error("Studio shop product publish failed",error instanceof Error?error.message:"unknown");
    return json({error:"Could not publish this product. Check shop storage setup and try again."},503);
  }
}
