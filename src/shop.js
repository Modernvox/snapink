import { mountShopCart } from "./shop-cart.js";
import { applyShopProductThumbnail, getSiteImageRendition } from "./utils/imageRenditions.js";

const root=document.querySelector("#shop-products");
const error=document.querySelector("#shop-error");
const categoryNav=document.querySelector("#shop-category-nav");
const usd=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
const jsonLd=(products)=>({"@context":"https://schema.org","@type":"ItemList",name:"Premium Swappable Snapback Hat Straps by SnapInk",itemListElement:products.map((product,index)=>({"@type":"ListItem",position:index+1,url:`https://snapbacksleeves.com/shop/${product.slug}`,item:{"@type":"Product",name:product.name,description:product.description,image:`https://snapbacksleeves.com${getSiteImageRendition(product.imageUrl)?.src||product.imageUrl}`,sku:product.productId,brand:{"@type":"Brand",name:"SnapInk"},offers:{"@type":"AggregateOffer",priceCurrency:"USD",lowPrice:(Math.min(...product.prices)/100).toFixed(2),highPrice:(Math.max(...product.prices)/100).toFixed(2),availability:"https://schema.org/InStock",url:`https://snapbacksleeves.com/shop/${product.slug}`}}}))});

let allProducts=[];
let categories=[];
let selectedCategory="";

function setCategoryFromUrl(){
  const requested=new URL(location.href).searchParams.get("category")||"";
  selectedCategory=categories.some((category)=>category.slug===requested)?requested:"";
  if(requested&&!selectedCategory){const url=new URL(location.href);url.searchParams.delete("category");history.replaceState({},"",url)}
}

function renderCategoryNav(){
  if(!categoryNav)return;
  categoryNav.replaceChildren();
  const options=[{slug:"",name:"All Designs",productCount:allProducts.length},...categories];
  for(const category of options){
    const button=document.createElement("button");button.type="button";button.className="shop-category-button";button.setAttribute("aria-pressed",String(category.slug===selectedCategory));
    const label=document.createElement("span");label.textContent=category.name;
    const count=document.createElement("span");count.className="shop-category-count";count.textContent=String(category.slug?category.productCount:allProducts.length);count.setAttribute("aria-label",`${count.textContent} products`);
    button.append(label,count);button.addEventListener("click",()=>{selectedCategory=category.slug;const url=new URL(location.href);if(selectedCategory)url.searchParams.set("category",selectedCategory);else url.searchParams.delete("category");history.pushState({},"",url);renderCategoryNav();renderProducts()});categoryNav.append(button);
  }
}

function renderProducts(){
  root.replaceChildren();
  const products=selectedCategory?allProducts.filter((product)=>product.categorySlug===selectedCategory):allProducts;
  for(const product of products){
    if(!product.variants?.length)continue;
    const variant=product.variants[0],card=document.createElement("article");card.className="shop-product-card";
    const link=document.createElement("a");link.href=`/shop/${product.slug}`;link.setAttribute("aria-label",`View ${product.name} details`);
    const image=document.createElement("img");applyShopProductThumbnail(image,product.imageUrl,"(max-width: 760px) 92vw, 30vw");image.alt=product.imageAlt;image.width||=1536;image.height||=1024;image.loading="lazy";image.decoding="async";
    const body=document.createElement("div");body.className="shop-product-card-body";
    const name=document.createElement("h3");name.textContent=product.name;
    const desc=document.createElement("p");desc.textContent=product.cardDescription||product.description;
    const price=document.createElement("strong");price.className="shop-starting";price.textContent=`Starting at ${usd(Math.min(...product.prices))}`;
    const color=document.createElement("span");color.className="shop-color-chip";const dot=document.createElement("i");dot.className="shop-color-dot";dot.setAttribute("aria-hidden","true");color.append(dot,document.createTextNode(variant.name));
    const button=document.createElement("span");button.className="shop-view-button";button.textContent="VIEW DETAILS";
    body.append(name,desc,price,color,button);link.append(image,body);card.append(link);root.append(card);
  }
  if(!root.children.length){const empty=document.createElement("p");empty.className="shop-loading";empty.textContent=selectedCategory?"No designs are available in this category yet.":"There are no exclusive designs available at this time.";root.append(empty)}
}

async function loadShopPage(){
  try{
    const response=await fetch("/api/shop/products",{cache:"no-store"}),data=await response.json().catch(()=>null);
    if(!response.ok||!Array.isArray(data?.products))throw new Error(data?.error||"Shop products are temporarily unavailable.");
    allProducts=data.products;categories=Array.isArray(data.categories)?data.categories:[];mountShopCart(allProducts);setCategoryFromUrl();renderCategoryNav();renderProducts();
    document.head.querySelector('script[data-shop-jsonld="true"]')?.remove();const script=document.createElement("script");script.type="application/ld+json";script.dataset.shopJsonld="true";script.textContent=JSON.stringify(jsonLd(allProducts));document.head.append(script);
  }catch(cause){root.replaceChildren();const message=document.createElement("p");message.className="shop-error";message.textContent=cause instanceof Error?cause.message:"Shop products could not be loaded.";root.append(message);error.textContent="If this continues, please contact SnapInk for help."}
}

addEventListener("popstate",()=>{setCategoryFromUrl();renderCategoryNav();renderProducts()});
loadShopPage();
