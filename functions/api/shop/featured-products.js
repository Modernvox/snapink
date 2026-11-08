import { json } from "../../_lib/orders.js";
import { readShopProducts, publicShopProduct, shopProductImageType } from "../../_lib/shop.js";

const MAX_FEATURED = 6;

function homepageProduct(product) {
  const publicProduct = publicShopProduct(product);
  if (!publicProduct.slug || !publicProduct.imageUrl || !publicProduct.variants.length) return null;
  const images = [{url:product.imageUrl,alt:product.imageAlt,label:product.imageAlt},...(product.gallery||[])];
  const deskImage = images.find((image) => shopProductImageType(image) === "on-desk");
  return {
    productId:publicProduct.productId,
    slug:publicProduct.slug,
    name:publicProduct.name,
    imageUrl:deskImage?.url||publicProduct.imageUrl,
    imageAlt:deskImage?.alt||publicProduct.imageAlt,
    prices:publicProduct.prices,
    categoryId:product.categoryId||null,
  };
}

export async function onRequestGet({env}) {
  if (!env.DB) return json({error:"The Shop catalog is temporarily unavailable."},503);
  try {
    const featuredResult = await env.DB.prepare(`SELECT product_id AS productId,category_id AS categoryId
      FROM shop_products WHERE active=1 AND featured=1 ORDER BY name,product_id LIMIT ?`).bind(MAX_FEATURED).all();
    const featuredRows = featuredResult.results||[];
    const featuredProducts = await readShopProducts(env.DB,{productIds:featuredRows.map((row)=>row.productId)});
    const featuredById = new Map(featuredProducts.map((product)=>[product.productId,product]));
    const selected = [];
    const selectedIds = new Set();
    for (const row of featuredRows) {
      const product=featuredById.get(row.productId),card=product&&homepageProduct(product);
      if(card&&!selectedIds.has(card.productId)){selected.push(card);selectedIds.add(card.productId)}
    }

    if (selected.length < MAX_FEATURED) {
      const candidateResult = await env.DB.prepare(`WITH ranked AS (
        SELECT product.product_id AS productId,product.category_id AS categoryId,
          COALESCE(category.sort_order,2147483647) AS categoryOrder,
          ROW_NUMBER() OVER (PARTITION BY COALESCE(product.category_id,'') ORDER BY product.name,product.product_id) AS categoryRank
        FROM shop_products AS product LEFT JOIN shop_product_categories AS category ON category.category_id=product.category_id
        WHERE product.active=1 AND product.featured=0
      )
      SELECT productId,categoryId,categoryOrder,categoryRank FROM ranked
      WHERE categoryRank<=6 ORDER BY categoryRank,categoryOrder,productId LIMIT 120`).all();
      const seenCategories=new Set(selected.map((product)=>product.categoryId||""));
      const diverse=[],remaining=[];
      for(const candidate of candidateResult.results||[]){
        if(selectedIds.has(candidate.productId))continue;
        const categoryKey=candidate.categoryId||"";
        if(!seenCategories.has(categoryKey)){seenCategories.add(categoryKey);diverse.push(candidate)}
        else remaining.push(candidate);
      }
      const candidates=[...diverse,...remaining];
      for(let offset=0;offset<candidates.length&&selected.length<MAX_FEATURED;offset+=6){
        const batch=candidates.slice(offset,offset+6),products=await readShopProducts(env.DB,{productIds:batch.map((candidate)=>candidate.productId)}),byId=new Map(products.map((product)=>[product.productId,product]));
        for(const candidate of batch){
          if(selected.length>=MAX_FEATURED)break;
          const product=byId.get(candidate.productId),card=product&&homepageProduct(product);
          if(card&&!selectedIds.has(card.productId)){selected.push(card);selectedIds.add(card.productId)}
        }
      }
    }

    return json({products:selected.map(({categoryId,...product})=>product),currency:"usd"});
  } catch(error) {
    console.error("Homepage Shop products read failed",error instanceof Error?error.message:"unknown");
    return json({error:"Homepage Shop products are temporarily unavailable."},503);
  }
}
