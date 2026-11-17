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
async function loadHomeShop() {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../src/home-shop.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const shop = await loadShop();
const {onRequestGet:onRequestFeatured}=await loadFeaturedEndpoint();

class SchemaCompatDb {
  constructor() {
    this.rows = [
      {productId:"nocap-id",slug:"no-cap-swappable-snapback-hat-strap-snapink-sleeve",name:"NO CAP – Swappable Snapback Hat Strap – SnapInk Sleeve™",description:"NO CAP design",imageUrl:"/nocap.png",imageAlt:"NO CAP on hat",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_streetwear_slang",categoryName:"Streetwear & Slang",categorySlug:"streetwear-slang",active:1},
      {productId:"boston-id",slug:"boston-snapink-sleevetm-swappable-snapback-hat-strap-snapink-sleeve",name:"BOSTON – SnapInk SleeveTM Swappable Snapback Hat Strap – SnapInk Sleeve™",description:"Boston design",imageUrl:"/boston.png",imageAlt:"BOSTON on hat",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_cities_states",categoryName:"Cities & States",categorySlug:"cities-states",active:1},
      {productId:"angel-id",slug:"angel-swappable-snapback-hat-strap-snapink-sleeve",name:"ANGEL – Swappable Snapback Hat Strap – SnapInk Sleeve™",description:"Angel design",imageUrl:"/angel.png",imageAlt:"ANGEL on hat",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_motivation_mindset",categoryName:"Motivation & Mindset",categorySlug:"motivation-mindset",active:1},
      {productId:"dad-id",slug:"dad-swappable-snapback-hat-strap-snapink-sleeve",name:"DAD – Swappable Snapback Hat Strap – SnapInk Sleeve™",description:"Dad design",imageUrl:"/dad.png",imageAlt:"DAD on hat",pricesJson:"[2499,2499,2499,2999,2999,2999]",artworkTier:"premium",productionMetadataJson:"{}",categoryId:"cat_lifestyle_identity",categoryName:"Lifestyle & Identity",categorySlug:"lifestyle-identity",active:1},
      {productId:"apex-id",slug:"apex-swappable-snapback-hat-strap-snapink-sleeve",name:"APEX – \u00ad\u00ad\u00ad Swappable Snapback Hat Strap – SnapInk Sleeve™",description:"Apex design",imageUrl:"/apex.png",imageAlt:"APEX on hat",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_sports_fan_culture",categoryName:"Sports & Fan Culture",categorySlug:"sports-fan-culture",active:1},
      {productId:"brandmark-id",slug:"snapink-signature-brandmark-snapink-sleevetm-swappable-snapback-hat-st",name:"Signature Brandmark Swappable Snapback Hat Strap – SnapInk Sleeve™",description:"Signature brandmark design",imageUrl:"/brandmark.png",imageAlt:"SnapInk Signature Brandmark on hat",pricesJson:"[1599,1599,1599,1599,1899,1899]",artworkTier:"standard",productionMetadataJson:"{}",categoryId:"cat_custom_designs",categoryName:"Custom Designs",categorySlug:"custom-designs",active:1},
    ];
    this.galleries=Object.fromEntries(this.rows.map((row)=>[row.productId,[{url:`/api/shop/product-image?key=shop-products%2F${row.productId}%2Fon-desk.png`,alt:`${row.name} On-Desk product image`,label:"On-Desk"}]]));
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
      if(sql.includes("FROM shop_products WHERE active=1 AND slug=?")) return this.rows.find((row)=>row.slug===bindings[0])||null;
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
  const standard=products.find((product)=>product.productId==="nocap-id");
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

test("featured products returns six diverse On-Desk cards with Signature Brandmark first", async()=>{
  const db=new SchemaCompatDb();
  const response=await onRequestFeatured({env:{DB:db}});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.products.length,6);
  assert.equal(body.products[0].name,"Signature Brandmark Swappable Snapback Hat Strap – SnapInk Sleeve™");
  assert.deepEqual(body.products.map((product)=>product.productId),["brandmark-id","nocap-id","boston-id","angel-id","dad-id","apex-id"]);
  assert.equal(new Set(body.products.map((product)=>product.productId)).size,6);
  const dad=body.products.find((product)=>product.productId==="dad-id");
  assert.deepEqual(dad.prices,[2499,2499,2499,2999,2999,2999]);
  assert.equal(shop.shopProductImageType({url:dad.imageUrl,alt:dad.imageAlt}),"on-desk");
  assert.ok(body.products.every((product)=>shop.shopProductImageType({url:product.imageUrl,alt:product.imageAlt})==="on-desk"));
  assert.ok(body.products.filter((product)=>product.productId!=="dad-id").every((product)=>product.prices[0]===1599));
});

test("homepage renders concise six-card labels, prices, thumbnail URLs, and product routes", async()=>{
  const body=await (await onRequestFeatured({env:{DB:new SchemaCompatDb()}})).json();
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.attributes={};}
    append(...children){this.children.push(...children)}
    replaceChildren(...children){this.children=[...children]}
    setAttribute(name,value){this.attributes[name]=value}
  }
  const section=new Element("section"),cards=new Element("div"),categoryLinks=new Element("nav");
  const previous={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  globalThis.document={querySelector:(selector)=>({".exclusive-shop-promo":section,".exclusive-shop-cards":cards,".home-category-links":categoryLinks}[selector]||null),createElement:(tag)=>new Element(tag)};
  globalThis.window={location:{origin:"https://snapink.test"}};
  globalThis.fetch=async(path)=>({ok:true,json:async()=>path.includes("featured-products")?body:{categories:[]}});
  try { await loadHomeShop(); await new Promise((resolve)=>setTimeout(resolve,0)); }
  finally { globalThis.document=previous.document;globalThis.window=previous.window;globalThis.fetch=previous.fetch; }
  assert.equal(cards.children.length,6);
  assert.deepEqual(cards.children.map((card)=>card.children[1].textContent),["SNAPINK Signature Brandmark","NO CAP","BOSTON","ANGEL","DAD","APEX"]);
  assert.ok(cards.children.every((card)=>card.children[3].textContent==="VIEW DESIGN"));
  assert.equal(cards.children[0].children[2].textContent,"From $15.99");
  assert.equal(cards.children[4].children[2].textContent,"From $24.99");
  assert.ok(cards.children.every((card)=>card.href.startsWith("/shop/")&&card.children[0].children[0].src.includes("variant=thumbnail")));
});
