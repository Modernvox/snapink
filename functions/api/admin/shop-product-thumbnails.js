import { bearer, json } from "../../_lib/orders.js";
import { parseShopGallery } from "../../_lib/shop.js";

const storedKeyPattern=/^shop-products\/studio-[a-f0-9-]{36}\/(?:[1-5]|on-hat|packaging|on-desk)\.png$/;

export async function onRequestPost({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB||!env.PRIVATE_ASSETS)return json({error:"Shop image storage is unavailable."},503);
  let form;try{form=await request.formData()}catch{return json({error:"Invalid thumbnail upload."},400)}
  const keys=form.getAll("imageKeys").map((key)=>String(key)),files=form.getAll("thumbnails").filter((file)=>file instanceof File);
  if(!keys.length||keys.length>100||keys.length!==files.length||new Set(keys).size!==keys.length||keys.some((key)=>!storedKeyPattern.test(key))||files.some((file)=>file.type!=="image/webp"||file.size<100||file.size>2*1024*1024))return json({error:"Product image thumbnails are invalid."},400);

  try {
    const [products,galleries]=await Promise.all([
      env.DB.prepare("SELECT image_url AS imageUrl FROM shop_products").all(),
      env.DB.prepare("SELECT gallery_json AS galleryJson FROM shop_product_galleries").all(),
    ]);
    const referenced=new Set();
    for(const row of products.results||[])collectKey(row.imageUrl,referenced);
    for(const row of galleries.results||[])for(const image of parseShopGallery(row.galleryJson))collectKey(image.url,referenced);
    if(keys.some((key)=>!referenced.has(key)))return json({error:"A selected image is not part of a current Shop product gallery."},400);
    for(let index=0;index<keys.length;index++)await env.PRIVATE_ASSETS.put(keys[index].replace(/\.png$/,"-thumb.webp"),files[index].stream(),{httpMetadata:{contentType:"image/webp",cacheControl:"public, max-age=31536000, immutable"}});
    return json({ok:true,thumbnailCount:keys.length});
  }catch(error){
    console.error("Shop gallery thumbnail backfill failed",error instanceof Error?error.message:"unknown");
    return json({error:"Could not save the product gallery thumbnails."},503);
  }
}

function collectKey(value,keys){
  if(typeof value!=="string")return;
  try{const url=new URL(value,"https://snapink.invalid"),key=url.searchParams.get("key")||"";if(url.pathname==="/api/shop/product-image"&&storedKeyPattern.test(key))keys.add(key)}catch{}
}
