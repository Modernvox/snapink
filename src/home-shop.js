import { applyShopProductThumbnail } from "./utils/imageRenditions.js";
import { shopProductDesignName } from "../functions/_lib/shop-product-name.js";

const section=document.querySelector(".exclusive-shop-promo"),cards=document.querySelector(".exclusive-shop-cards");
const usd=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
async function renderExclusiveProducts(){
  if(!section||!cards)return;
  cards.replaceChildren();
  try{
    const response=await fetch("/api/shop/featured-products",{cache:"no-store"}),data=await response.json().catch(()=>null);
    if(!response.ok||!Array.isArray(data?.products))return;
    const products=data.products.filter((product)=>product.slug&&product.imageUrl&&Array.isArray(product.prices)&&product.prices.length===6&&product.prices.every((price)=>Number.isSafeInteger(price)&&price>0)).slice(0,6);
    for(const product of products){
      const name=shopProductDesignName(product.name),card=document.createElement("a"),frame=document.createElement("span"),image=document.createElement("img"),title=document.createElement("span"),price=document.createElement("span"),cta=document.createElement("span");
      card.href=`/shop/${encodeURIComponent(product.slug)}`;card.setAttribute("aria-label",`Shop ${product.name}`);
      frame.className="exclusive-shop-card-image";applyShopProductThumbnail(image,product.imageUrl,"(max-width: 700px) 100vw, 50vw");image.alt=product.imageAlt||`${product.name} SnapInk sleeve product image`;image.width||=1536;image.height||=1024;image.loading="lazy";image.decoding="async";frame.append(image);
      title.className="exclusive-shop-card-name";title.textContent=product.name;
      price.className="exclusive-shop-card-price";price.textContent=`From ${usd(Math.min(...product.prices))}`;
      cta.className="exclusive-shop-card-cta";cta.textContent=`SHOP ${name}`;
      card.append(frame,title,price,cta);cards.append(card);
    }
    const hasProducts=products.length>0;cards.hidden=!hasProducts;
  }catch{cards.replaceChildren();cards.hidden=true}
}

void renderExclusiveProducts();
