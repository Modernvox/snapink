import { mountShopCart } from "./shop-cart.js";

const root=document.querySelector("#shop-products");
const error=document.querySelector("#shop-error");
const usd=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
const jsonLd=(products)=>({"@context":"https://schema.org","@type":"ItemList",name:"SnapInk Exclusive Sleeves",itemListElement:products.map((product,index)=>({"@type":"ListItem",position:index+1,url:`https://snapbacksleeves.com/shop/${product.slug}`,item:{"@type":"Product",name:`SnapInk ${product.name} Sleeve`,description:product.description,image:`https://snapbacksleeves.com${product.imageUrl}`,brand:{"@type":"Brand",name:"SnapInk"},offers:{"@type":"AggregateOffer",priceCurrency:"USD",lowPrice:(Math.min(...product.prices)/100).toFixed(2),highPrice:(Math.max(...product.prices)/100).toFixed(2),url:`https://snapbacksleeves.com/shop/${product.slug}`}}}))});

async function loadShopPage(){
try{
  const response=await fetch("/api/shop/products",{cache:"no-store"}),data=await response.json().catch(()=>null);
  if(!response.ok||!Array.isArray(data?.products))throw new Error(data?.error||"Shop products are temporarily unavailable.");
  const products=data.products;mountShopCart(products);root.replaceChildren();
  for(const product of products){
    if(!product.variants?.length)continue;
    const variant=product.variants[0],card=document.createElement("article");card.className="shop-product-card";
    const link=document.createElement("a");link.href=`/shop/${product.slug}`;link.setAttribute("aria-label",`View ${product.name} SnapInk sleeve details`);
    const image=document.createElement("img");image.src=product.imageUrl;image.alt=product.imageAlt;image.width=1536;image.height=1024;image.loading="lazy";image.decoding="async";
    const body=document.createElement("div");body.className="shop-product-card-body";
    const name=document.createElement("h3");name.textContent=product.name;
    const desc=document.createElement("p");desc.textContent=product.description;
    const price=document.createElement("strong");price.className="shop-starting";price.textContent=`Starting at ${usd(Math.min(...product.prices))}`;
    const color=document.createElement("span");color.className="shop-color-chip";const dot=document.createElement("i");dot.className="shop-color-dot";dot.setAttribute("aria-hidden","true");color.append(dot,document.createTextNode(variant.name));
    const button=document.createElement("span");button.className="shop-view-button";button.textContent="VIEW DETAILS";
    body.append(name,desc,price,color,button);link.append(image,body);card.append(link);root.append(card);
  }
  const script=document.createElement("script");script.type="application/ld+json";script.textContent=JSON.stringify(jsonLd(products));document.head.append(script);
  if(!root.children.length)throw new Error("There are no exclusive designs available at this time.");
}catch(cause){root.innerHTML="";const message=document.createElement("p");message.className="shop-error";message.textContent=cause instanceof Error?cause.message:"Shop products could not be loaded.";root.append(message);error.textContent="If this continues, please contact SnapInk for help."}
}
loadShopPage();
