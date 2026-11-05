import { bearer, json, now } from "../../_lib/orders.js";

const defaultCardDescription = (name) => `${name} features custom artwork on a SnapInk sleeve for compatible snapback hats.`;
const defaultDescription = (name) => `${name} brings a distinctive SnapInk detail to compatible snapback hats. Choose your sleeve size and color to complete your look. Sleeve only; hat sold separately.`;
const cleanCardDescription = (value) => String(value||"").replace(/!\[([^\]]*)\]\([^)]+\)/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/<[^>]*>/g,"").replace(/^\s*(?:[-*+]|\d+\.)\s+/gm,"").replace(/[`*_~>#]/g,"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim();
const safeSlug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70).replace(/-+$/g,"");

export async function onRequestGet({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  return json({ok:true});
}

export async function onRequestPost({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN)) return json({error:"Unauthorized"},401);
  if(!env.DB||!env.PRIVATE_ASSETS) return json({error:"Shop storage is unavailable. Confirm the shop database and private asset bucket are configured."},503);
  let form; try { form=await request.formData(); } catch { return json({error:"Product details or images are invalid."},400); }
  const name=String(form.get("name")||"").trim();
  const cardDescription=cleanCardDescription(form.get("cardDescription"))||defaultCardDescription(name);
  let description=String(form.get("description")||"").trim()||defaultDescription(name);
  const style=String(form.get("style")||""), color=String(form.get("color")||"").trim();
  const extendedArtwork=String(form.get("extendedArtwork")||"false")==="true";
  const extensionMm=Number(form.get("artworkExtensionMm")||0), artworkWidthMm=Number(form.get("artworkWidthMm")||0), artworkHeightMm=Number(form.get("artworkHeightMm")||0);
  if (extendedArtwork) {
    if (String(form.get("approveExtendedArtwork"))!=="true") return json({error:"Explicit administrator approval is required to publish extended artwork at its premium price."},403);
    if (!Number.isFinite(extensionMm)||extensionMm<=0||extensionMm>12.701||!Number.isFinite(artworkWidthMm)||artworkWidthMm<=0||!Number.isFinite(artworkHeightMm)||artworkHeightMm<=0) return json({error:"Extended artwork measurements are invalid or exceed the 12.7 mm limit."},400);
    const heightScale=Number(form.get("artworkHeightScale")), centerX=Number(form.get("artworkCenterXmm")), centerY=Number(form.get("artworkCenterYmm"));
    if (![heightScale,centerX,centerY].every(Number.isFinite)||heightScale<25||heightScale>200) return json({error:"Extended artwork position and scale must be valid before publishing."},400);
  } else if (extensionMm > 0.001) return json({error:"The artwork extension status does not match its measured dimensions."},400);
  if(extendedArtwork) description=`${description}\n\nExtended artwork pricing: sizes 0–2 $24.99; sizes 3–5 $29.99. Final production feasibility will be confirmed during design review.`;
  if(!name||name.length>100||!safeSlug(name)||cardDescription.length>240||description.length>2000||!['standard','billboard'].includes(style)||!/^#[0-9a-f]{6}$/i.test(color)) return json({error:"Enter a product name and use the current sleeve style and color."},400);
  const imageFields=[["onHat","On-Hat Product Image"],["packaging","Packaging Product Image"],["onDesk","On-Desk Product Image"]];
  const files=[];
  for(const [field,label] of imageFields){const file=form.get(field);if(!(file instanceof File)||file.type!=="image/png"||file.size<100||file.size>18*1024*1024)return json({error:`${label} is missing or invalid. Generate all three product images before publishing.`},400);files.push(file);}
  const slug=safeSlug(name);
  const prices=extendedArtwork?[2499,2499,2499,2999,2999,2999]:[1599,1599,1599,1599,1899,1899];
  const existing=await env.DB.prepare("SELECT product_id AS productId,slug FROM shop_products WHERE slug=?").bind(slug).first();
  if(existing)return json({ok:true,duplicate:true,product:{productId:existing.productId,slug:existing.slug,url:`/shop/${existing.slug}`}});
  const productId=`studio-${crypto.randomUUID()}`, time=now(), objectKeys=files.map((_,i)=>`shop-products/${productId}/${["on-hat","packaging","on-desk"][i]}.png`);
  try {
    for(let i=0;i<files.length;i++) await env.PRIVATE_ASSETS.put(objectKeys[i],files[i].stream(),{httpMetadata:{contentType:"image/png",cacheControl:"public, max-age=31536000, immutable"}});
    const urls=objectKeys.map(key=>`/api/shop/product-image?key=${encodeURIComponent(key)}`);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shop_products(product_id,slug,name,description,card_description,image_url,image_alt,prices_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)").bind(productId,slug,name,description,cardDescription,urls[0],`${name} sleeve displayed on a snapback hat`,JSON.stringify(prices),time,time),
      env.DB.prepare("INSERT INTO shop_product_variants(product_id,variant_id,variant_name,sleeve_color,artwork_color,available_sizes_json,active) VALUES(?,?,?,?,?,?,1)").bind(productId,"studio",`${style === "billboard" ? "Billboard" : "Standard"} custom design`,color, "Custom",JSON.stringify([0,1,2,3,4,5])),
      env.DB.prepare("INSERT INTO shop_product_galleries(product_id,gallery_json) VALUES(?,?)").bind(productId,JSON.stringify([{url:urls[1],alt:`${name} SnapInk sleeve packaging`,label:"Packaging"},{url:urls[2],alt:`${name} SnapInk sleeve on a desk`,label:"On desk"}])),
    ]);
    return json({ok:true,product:{productId,slug,url:`/shop/${slug}`}} ,201);
  } catch(error) {
    for(const key of objectKeys) await env.PRIVATE_ASSETS.delete(key).catch(()=>{});
    const duplicate=await env.DB.prepare("SELECT product_id AS productId,slug FROM shop_products WHERE slug=?").bind(slug).first().catch(()=>null);
    if(duplicate)return json({ok:true,duplicate:true,product:{productId:duplicate.productId,slug:duplicate.slug,url:`/shop/${duplicate.slug}`}});
    console.error("Studio shop product publish failed",error instanceof Error?error.message:"unknown");
    return json({error:"Could not publish this product. Check shop storage setup and try again."},503);
  }
}
