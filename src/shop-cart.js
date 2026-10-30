import { calculateShopCartPricing } from "../functions/_lib/retail-pricing.mjs";

const STORAGE_KEY="snapink-exclusive-shop-cart";
const usd=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
const safeCart=()=>{try{const cart=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");return Array.isArray(cart)?cart.filter((item)=>item&&typeof item.productId==="string"&&typeof item.variantId==="string"&&Number.isInteger(item.size)&&Number.isInteger(item.quantity)):[]}catch{return[]}};

export function mountShopCart(products){
  const productMap=Object.fromEntries(products.map((product)=>[product.productId,product]));
  let trigger=document.querySelector(".shop-cart-trigger");
  if(!trigger){
    const header=document.querySelector("header");
    trigger=document.createElement("button");trigger.type="button";trigger.className="shop-cart-trigger";trigger.setAttribute("aria-haspopup","dialog");trigger.innerHTML='BAG <span class="shop-cart-count">0</span>';
    header?.append(trigger);
  }
  let dialog=document.querySelector("#shop-cart-dialog");
  if(!dialog){
    dialog=document.createElement("dialog");dialog.id="shop-cart-dialog";dialog.className="shop-cart-dialog";
    dialog.innerHTML=`<div class="shop-cart-head"><div><p class="shop-eyebrow">Your bag</p><h2>Review your order</h2></div><button type="button" class="shop-close" aria-label="Close cart">×</button></div><div class="shop-cart-lines"></div><div class="shop-totals"></div><div class="shop-checkout-actions"><p class="shop-checkout-copy">Stripe securely collects your name, email, and US shipping address.</p><p class="shop-cart-message" role="status" aria-live="polite"></p><button class="shop-checkout-button" type="button">Secure Checkout with Stripe</button></div>`;
    document.body.append(dialog);
    dialog.querySelector(".shop-close").addEventListener("click",()=>dialog.close());
    dialog.addEventListener("click",(event)=>{if(event.target===dialog)dialog.close()});
  }
  trigger?.addEventListener("click",()=>dialog.showModal());
  const persist=(cart)=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(cart));render()};
  const render=()=>{
    const cart=safeCart();
    const count=cart.reduce((sum,item)=>sum+item.quantity,0);
    document.querySelectorAll(".shop-cart-count").forEach((node)=>node.textContent=String(count));
    const lines=dialog.querySelector(".shop-cart-lines"),totals=dialog.querySelector(".shop-totals");lines.replaceChildren();totals.replaceChildren();
    if(!cart.length){lines.textContent="Your bag is empty.";dialog.querySelector(".shop-checkout-actions").hidden=true;return}
    dialog.querySelector(".shop-checkout-actions").hidden=false;
    cart.forEach((item,index)=>{
      const product=productMap[item.productId];if(!product)return;
      const variant=product.variants.find((entry)=>entry.variantId===item.variantId)||product.variants[0];
      const row=document.createElement("article");row.className="shop-cart-line";
      const image=document.createElement("img");image.src=variant?.sleeveImageUrl||product.imageUrl;image.alt=variant?.sleeveImageAlt||`${product.name} SnapInk Sleeve only; hat not included`;image.loading="lazy";
      const info=document.createElement("div"),title=document.createElement("strong"),clarification=document.createElement("p"),desc=document.createElement("p"),controls=document.createElement("div"),qty=document.createElement("input"),remove=document.createElement("button");
      title.textContent=product.name;desc.textContent=`${variant?.name||"Black sleeve / white artwork"} · Size ${item.size} · ${usd(product.prices[item.size])} each`;
      clarification.className="shop-cart-product-note";clarification.textContent="SnapInk Sleeve™ — Hat not included";
      controls.className="shop-cart-controls";qty.type="number";qty.min="1";qty.max="100";qty.value=String(item.quantity);qty.setAttribute("aria-label",`${product.name} quantity`);qty.addEventListener("change",()=>{const next=safeCart();next[index].quantity=Math.max(1,Math.min(100,Number(qty.value)||1));persist(next)});
      remove.type="button";remove.className="shop-remove";remove.textContent="Remove";remove.addEventListener("click",()=>persist(safeCart().filter((_,line)=>line!==index)));
      controls.append(qty,remove);info.append(title,clarification,desc,controls);row.append(image,info);lines.append(row);
    });
    try{
      const priced=calculateShopCartPricing(cart,productMap);
      const data=[["Merchandise subtotal",priced.merchandiseSubtotalCents],["Quantity discount",-priced.discountCents],["Standard shipping",priced.shippingCents],["Total before tax",priced.totalBeforeTaxCents]];
      for(const [label,value] of data){if(label==="Quantity discount"&&!value)continue;const row=document.createElement("div");row.className="shop-total-row";const name=document.createElement("span"),amount=document.createElement("strong");name.textContent=label;amount.textContent=`${value<0?"−":""}${usd(Math.abs(value))}`;row.append(name,amount);totals.append(row)}
      const tax=document.createElement("p");tax.className="shop-tax-note";tax.textContent="Tax is not calculated or included in this order total.";totals.append(tax);
    }catch(error){const message=document.createElement("p");message.className="shop-error";message.textContent=error.message;totals.append(message)}
  };
  window.snapInkShopAdd=(productId,variantId,size,quantity=1)=>{
    const product=productMap[productId];if(!product)return;
    const cart=safeCart(),found=cart.find((item)=>item.productId===productId&&item.variantId===variantId&&item.size===size);
    if(found)found.quantity=Math.min(100,found.quantity+quantity);else cart.push({productId,variantId,size,quantity});
    persist(cart);dialog.showModal();
  };
  dialog.querySelector(".shop-checkout-button").addEventListener("click",async(event)=>{
    const button=event.currentTarget,message=dialog.querySelector(".shop-cart-message");
    const cart=safeCart();if(!cart.length){message.textContent="Your bag is empty.";return}
    button.disabled=true;message.className="shop-cart-message";message.textContent="Preparing secure checkout…";
    try{
      const response=await fetch("/api/shop/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idempotencyKey:crypto.randomUUID(),items:cart})});
      const result=await response.json().catch(()=>null);if(!response.ok||!result?.checkoutUrl)throw new Error(result?.error||"Secure checkout could not be started. Please try again.");
      localStorage.removeItem(STORAGE_KEY);location.assign(result.checkoutUrl);
    }catch(error){message.className="shop-cart-message shop-error";message.textContent=error instanceof Error?error.message:"Checkout failed. Please try again.";button.disabled=false}
  });
  render();return {add:window.snapInkShopAdd,refresh:render};
}
