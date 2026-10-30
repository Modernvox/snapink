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
    dialog.innerHTML=`<div class="shop-cart-head"><div><p class="shop-eyebrow">Your bag</p><h2>Review your order</h2></div><button type="button" class="shop-close" aria-label="Close cart">×</button></div><div class="shop-cart-lines"></div><div class="shop-totals"></div><form class="shop-checkout-form"><h3>Shipping details</h3><div class="shop-checkout-grid"><label>Name<input name="name" autocomplete="name" required maxlength="120"></label><label>Email<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>Phone <small>(optional)</small><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label><label>Street address<input name="line1" autocomplete="address-line1" required maxlength="150"></label><label>Apartment / unit <small>(optional)</small><input name="line2" autocomplete="address-line2" maxlength="150"></label><label>City<input name="city" autocomplete="address-level2" required maxlength="100"></label><label>State / province<input name="region" autocomplete="address-level1" required maxlength="100"></label><label>ZIP / postal code<input name="postalCode" autocomplete="postal-code" required maxlength="24"></label><label>Country code<input name="country" value="US" autocomplete="country" required pattern="[A-Za-z]{2}" maxlength="2" aria-describedby="shop-country-help"><small id="shop-country-help">Two-letter code, such as US or CA.</small></label></div><p class="shop-tax-note">Tax is not calculated or included in this order total. No card details are stored on SnapInk servers.</p><p class="shop-cart-message" role="status" aria-live="polite"></p><button class="shop-checkout-button" type="submit">CONTINUE TO SECURE CHECKOUT</button></form>`;
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
    if(!cart.length){lines.textContent="Your bag is empty.";dialog.querySelector(".shop-checkout-form").hidden=true;return}
    dialog.querySelector(".shop-checkout-form").hidden=false;
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
  dialog.querySelector(".shop-checkout-form").addEventListener("submit",async(event)=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector("button[type=submit]"),message=dialog.querySelector(".shop-cart-message");
    const cart=safeCart();if(!cart.length){message.textContent="Your bag is empty.";return}
    const data=new FormData(form);button.disabled=true;message.className="shop-cart-message";message.textContent="Preparing secure checkout…";
    try{
      const response=await fetch("/api/shop/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idempotencyKey:crypto.randomUUID(),items:cart,customer:{name:data.get("name"),email:data.get("email"),phone:data.get("phone")},shippingAddress:{line1:data.get("line1"),line2:data.get("line2"),city:data.get("city"),region:data.get("region"),postalCode:data.get("postalCode"),country:String(data.get("country")).toUpperCase()}})});
      const result=await response.json().catch(()=>null);if(!response.ok||!result?.checkoutUrl)throw new Error(result?.error||"Secure checkout could not be started. Please try again.");
      localStorage.removeItem(STORAGE_KEY);location.assign(result.checkoutUrl);
    }catch(error){message.className="shop-cart-message shop-error";message.textContent=error instanceof Error?error.message:"Checkout failed. Please try again.";button.disabled=false}
  });
  render();return {add:window.snapInkShopAdd,refresh:render};
}
