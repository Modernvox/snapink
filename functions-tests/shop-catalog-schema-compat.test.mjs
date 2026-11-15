import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { calculateShopCartPricing } from "../functions/_lib/retail-pricing.mjs";

async function loadShop() {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../functions/_lib/shop.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}
async function loadFeaturedEndpoint() {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../functions/api/shop/featured-products.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const shop = await loadShop();
const {onRequestGet:onRequestFeatured}=await loadFeaturedEndpoint();

class SchemaCompatDb {
  constructor() {
    this.rows = [
      {productId:"dad-id",slug:"dad",name:"DAD",description:"Dad design",imageUrl:"/dad.png",imageAlt:"DAD on desk",pricesJson:"[2499,2499,2499,2999,2999,2999]",artworkTier:"premium",productionMetadataJson:"{}",categoryId:"cat_lifestyle_identity",categoryName:"Lifestyle & Identity",categorySlug:"lifestyle-identity",active:1},
      {productId:"standard-id",slug:"standard",name:"Standard",description:"Standard design",imageUrl:"/standard.png",imageAlt:"Standard on desk",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_streetwear_slang",categoryName:"Streetwear & Slang",categorySlug:"streetwear-slang",active:1},
      {productId:"city-id",slug:"city",name:"City",description:"City design",imageUrl:"/city-main.png",imageAlt:"City on hat",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_cities_states",categoryName:"Cities & States",categorySlug:"cities-states",active:1},
      {productId:"mindset-id",slug:"mindset",name:"Mindset",description:"Mindset design",imageUrl:"/mindset-main.png",imageAlt:"Mindset on hat",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_motivation_mindset",categoryName:"Motivation & Mindset",categorySlug:"motivation-mindset",active:1},
    ];
    this.galleries={"dad-id":[{url:"/dad-on-desk.png",alt:"DAD on desk",label:"On-Desk"}],"standard-id":[{url:"/standard-on-desk.png",alt:"Standard on desk",label:"On-Desk"}],"city-id":[{url:"/city-on-desk.png",alt:"City on desk",label:"On-Desk"}],"mindset-id":[{url:"/mindset-on-desk.png",alt:"Mindset on desk",label:"On-Desk"}]};
    this.statements=[];
  }
  prepare(sql) {
    this.statements.push(sql);
    const bindings=[];
    const run=(...args)=>{bindings.push(...args);return {all,first,run:async()=>({meta:{changes:0}})}};
    const all=async()=>{
      if(sql.includes("FROM shop_products WHERE active=1 AND featured=1")) throw new Error("no such column: featured");
      if(sql.includes("WITH ranked AS")) return {results:this.rows.map((row,index)=>({productId:row.productId,categoryId:row.categoryId,categoryOrder:index,categoryRank:1}))};
      if(sql.includes("FROM shop_products AS product")) {
        if(sql.includes("product.featured")) throw new Error("no such column: product.featured");
        assert.match(sql,/product\.artwork_tier AS artworkTier/);
        assert.match(sql,/product\.production_metadata_json AS productionMetadataJson/);
        const ids=sql.includes("product.product_id IN")?new Set(bindings):null;
        return {results:this.rows.filter((row)=>!ids||ids.has(row.productId))};
      }
      if(sql.includes("FROM shop_product_variants")) return {results:[{variantId:"studio",name:"Black sleeve / white artwork",sleeveColor:"black",artworkColor:"white",availableSizesJson:"[0,1,2,3,4,5]",active:1}]};
      if(sql.includes("FROM shop_inventory")) return {results:[]};
      if(sql.includes("FROM shop_product_galleries")) return {results:[]};
      throw new Error(`Unexpected query: ${sql}`);
    };
    const first=async()=>{
      if(sql.includes("FROM shop_product_galleries")) return {galleryJson:JSON.stringify(this.galleries[bindings[0]]||[])};
      throw new Error(`Unexpected first query: ${sql}`);
    };
    return {bind:(...args)=>run(...args),all,first,run:async()=>({meta:{changes:0}})};
  }
}

test("schema fallback retains artwork tier and premium pricing when featured is absent", async()=>{
  const db=new SchemaCompatDb();
  const products=await shop.readShopProducts(db);
  const dad=products.find((product)=>product.productId==="dad-id");
  const standard=products.find((product)=>product.productId==="standard-id");
  assert.equal(dad.artworkTier,"premium");
  assert.deepEqual(dad.prices,shop.PREMIUM_EXTENDED_SHOP_PRICES);
  assert.equal(shop.publicShopProduct(dad).artworkTier,"premium");
  assert.deepEqual(shop.publicShopProduct(dad).prices,shop.PREMIUM_EXTENDED_SHOP_PRICES);
  assert.equal(calculateShopCartPricing([{productId:"dad-id",variantId:"studio",size:0,quantity:1}],products).items[0].unitPriceCents,2499);
  assert.equal(standard.artworkTier,"standard");
  assert.deepEqual(standard.prices,[1599,1599,1599,1599,1899,1899]);
  assert.ok(db.statements.some((sql)=>sql.includes("product.featured")));
  assert.ok(db.statements.some((sql)=>sql.includes("product.artwork_tier AS artworkTier")&&!sql.includes("product.featured")));
});

test("featured products returns four On-Desk cards with schema-compatible prices", async()=>{
  const db=new SchemaCompatDb();
  const response=await onRequestFeatured({env:{DB:db}});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.products.length,4);
  const dad=body.products.find((product)=>product.productId==="dad-id");
  assert.deepEqual(dad.prices,[2499,2499,2499,2999,2999,2999]);
  assert.equal(shop.shopProductImageType({url:dad.imageUrl,alt:dad.imageAlt}),"on-desk");
  assert.ok(body.products.every((product)=>shop.shopProductImageType({url:product.imageUrl,alt:product.imageAlt})==="on-desk"));
});
