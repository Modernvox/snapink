import partnerTemplate from "./wholesale-partner-template.html?raw";
const $ = (id) => document.getElementById(id);
const usd = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const statusNames = { pending_review:"Pending Review", awaiting_artwork_approval:"Awaiting Artwork Approval", approved_awaiting_payment:"Approved / Awaiting Payment Arrangement", scheduled_for_production:"Scheduled for Production", in_production:"In Production", ready_to_ship:"Ready to Ship", shipped:"Shipped", completed:"Completed", cancelled:"Cancelled" };
let config = null, orders = [], draftLines = [], submitting = false;
let pendingIdempotencyKey = sessionStorage.getItem("snapink.wholesale.pendingRequest") || "";

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
  if ((response.status === 401 || response.status === 403) && config && $("partner-area")?.childElementCount) clearPartnerSession(true);
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function message(id, text, error = false) { const el = $(id); el.textContent = text; el.classList.toggle("error", error); }
function clearPendingKey(){pendingIdempotencyKey="";sessionStorage.removeItem("snapink.wholesale.pendingRequest");}
async function loadPrivateImage(image, path) {
  try {
    const response = await fetch(path, { credentials:"same-origin", cache:"no-store" });
    if (response.status === 401 || response.status === 403) { clearPartnerSession(true); return; }
    if (!response.ok) return;
    const objectUrl = URL.createObjectURL(await response.blob());
    image.src = objectUrl;
    image.addEventListener("load", () => setTimeout(() => URL.revokeObjectURL(objectUrl), 60000), { once:true });
  } catch {}
}
function clearPartnerSession(expired = false) {
  fetch("/api/partner-portal",{method:"DELETE",credentials:"same-origin",cache:"no-store"}).catch(()=>{});
  clearPendingKey();
  config = null; orders = []; draftLines = []; submitting = false;
  const area = $("partner-area");
  if (area) { area.replaceChildren(); area.classList.add("hidden"); }
  $("access-panel")?.classList.remove("hidden");
  const password = $("partner-token"); if (password) password.value = "";
  if (expired) message("access-message", "Your partner session is no longer active. Sign in again to access wholesale ordering.", true);
}
function renderAuthorizedPricing() {
  const pricing = config.pricing;
  const label = (tier) => tier.max ? `${tier.min}–${tier.max}` : `${tier.min}+`;
  $("blank-pricing-tiers").replaceChildren(...pricing.blankTiers.map((tier) => {
    const row = document.createElement("tr");
    for (const value of [`${label(tier)} blanks`, `${usd(tier.sizes03)} each`, `${usd(tier.sizes46)} each`]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    return row;
  }));
  $("custom-pricing-tiers").replaceChildren(...pricing.customTiers.map((tier) => {
    const row = document.createElement("tr");
    for (const value of [`${label(tier)} custom`, `${usd(tier.unitPriceCents)} each`]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    return row;
  }));
  $("minimum-copy").textContent = `Minimums are ${pricing.minimumQuantity} blank sleeves and ${pricing.customMinimumQuantity} custom printed sleeves. Blank and custom quantities qualify for tiers separately. Shipping and taxes are determined separately.`;
  $("lead-time-copy").textContent = `${config.leadTimes.map((item) => `${item.min}${item.max ? `–${item.max}` : "+"} sleeves: ${item.label}`).join(" · ")}. Estimates are not guarantees; shipping transit time is additional.`;
}
function addressFields(prefix, initial = {}) {
  const fields = [["line1","Street address",true],["line2","Address line 2",false],["city","City",true],["state","State / province",true],["postalCode","ZIP / postal code",true],["country","Country",true]];
  return fields.map(([key,label,required]) => `<label class="${key === "line1" || key === "line2" ? "wide" : ""}">${label}${required ? " *" : ""}<input data-address="${prefix}" data-key="${key}" maxlength="${key === "line1" || key === "line2" ? 160 : 100}" ${required ? "required" : ""} autocomplete="${prefix} ${key}" value="${escape(initial[key])}"></label>`).join("");
}
function readAddress(prefix) { const result = {}; document.querySelectorAll(`[data-address="${prefix}"]`).forEach((input) => result[input.dataset.key] = input.value.trim()); return result; }
function syncBillingFields() { const same=$("billing-same").checked;$("billing-wrap").classList.toggle("hidden",same);document.querySelectorAll('[data-address="billing"]').forEach(input=>{input.disabled=same;input.required=!same;}); }
function lineMarkup(line, index) {
  const colorOptions = (config?.colors || []).map(color => `<option value="${escape(color.id)}" ${line.baseColorId === color.id ? "selected" : ""}>${escape(color.manufacturer)} · ${escape(color.name)}</option>`).join("");
  const selectedColor = (config?.colors || []).find(color => color.id === line.baseColorId);
  const studioUrl = new URL("/wholesale-studio.html", location.origin);
  for (const [key, value] of Object.entries({variant:line.sleeveStyle||"billboard",size:line.size??4,color:line.baseColorId||""})) studioUrl.searchParams.set(key,value);
  studioUrl.searchParams.set("returnLine",String(index));
  if(line.wholesaleDesignId||line.sourceDesignId)studioUrl.searchParams.set("designId",line.wholesaleDesignId||line.sourceDesignId);
  return `<article class="line-item" data-line="${index}">
    <label class="span-2">Size<select data-field="size">${[0,1,2,3,4,5,6].map(n => `<option value="${n}" ${line.size === n ? "selected" : ""}>Size ${n}</option>`).join("")}</select></label>
    <label class="span-2">Quantity<input data-field="quantity" type="number" min="1" max="10000" step="1" inputmode="numeric" value="${line.quantity || 1}"></label>
    <label class="span-2">Order option<select data-field="designType"><option value="blank" ${line.designType === "blank" ? "selected" : ""}>Blank sleeve</option><option value="custom_branding" ${line.designType === "custom_branding" ? "selected" : ""}>Custom Studio design</option>${(config?.approvedDesigns||[]).map(design=>`<option value="approved_design" data-id="${escape(design.id)}" ${line.designType === "approved_design"&&line.designId===design.id?"selected":""}>${escape(design.name)}</option>`).join("")}</select></label>
    <label class="span-3">Matte TPU base color<select data-field="baseColorId" required><option value="">Select approved available color</option>${colorOptions}</select></label>
    <label class="span-2">Sleeve style<select data-field="sleeveStyle"><option value="standard" ${line.sleeveStyle === "standard" ? "selected" : ""}>Standard</option><option value="billboard" ${line.sleeveStyle !== "standard" ? "selected" : ""}>Billboard</option></select></label>
    <div class="span-5 color-preview">${selectedColor ? `<span class="swatch" style="--swatch:${escape(selectedColor.hex)}"></span>${escape(selectedColor.manufacturer)} ${escape(selectedColor.name)} · ${escape(selectedColor.materialType)} matte` : "No colors are currently enabled. Ask SnapInk to confirm supplier availability."}</div>
    <div class="span-6 studio-tools ${line.designType === "custom_branding" ? "" : "hidden"}"><a class="studio-link" href="${studioUrl.pathname + studioUrl.search}" target="_blank" rel="noopener">${line.wholesaleDesignId||line.sourceDesignId ? "Reopen saved design in Studio" : "Create custom design in SnapInk Studio"}</a><span class="design-preview">${line.wholesaleDesignId ? `<img data-private-preview="/api/wholesale/design-preview?id=${encodeURIComponent(line.wholesaleDesignId)}" alt="Private custom design preview">Colors used: ${new Set([selectedColor?.hex?.toUpperCase(),...(line.artworkColors||[]).map(id=>config?.colors?.find(c=>c.id===id)?.hex?.toUpperCase()||String(id).toUpperCase())].filter(Boolean)).size} / 3 · ${escape((line.artworkColors||[]).map(id=>config?.colors?.find(c=>c.id===id)?.name||id).join(", "))}${line.colorReviewRequired?" · Artwork palette needs SnapInk review":""}` : "Studio design required before this custom line can be submitted."}</span></div>
    <label class="span-5">Design reference / Studio design ID<input data-field="designReference" maxlength="160" value="${escape(line.designReference || line.studioDesignId)}" placeholder="Optional reference"></label>
    <label class="span-6">Design notes<input data-field="designNotes" maxlength="700" value="${escape(line.designNotes)}" placeholder="Optional notes"></label>
    <div class="line-subtotal span-6" data-line-price></div><button class="secondary remove-line span-2" type="button">Remove line</button>
  </article>`;
}
function renderLines() {
  $("line-items").innerHTML = draftLines.map(lineMarkup).join("");
  $("line-items").querySelectorAll("[data-private-preview]").forEach(image => loadPrivateImage(image, image.dataset.privatePreview));
  $("line-items").querySelectorAll(".line-item").forEach((item, index) => {
    item.querySelectorAll("[data-field]").forEach(control => control.addEventListener(control.tagName==="SELECT"?"change":"input", () => { const field=control.dataset.field;let rerender=false;if(field!=="artwork"){draftLines[index][field]=field==="size"||field==="quantity"?Number(control.value):control.value;if(field==="designType"){draftLines[index].designId=control.selectedOptions[0]?.dataset.id||"";if(draftLines[index].wholesaleDesignId)draftLines[index].sourceDesignId=draftLines[index].wholesaleDesignId;draftLines[index].wholesaleDesignId="";rerender=true;}if(field==="baseColorId"||field==="size"||field==="sleeveStyle"){if(draftLines[index].wholesaleDesignId)draftLines[index].sourceDesignId=draftLines[index].wholesaleDesignId;draftLines[index].wholesaleDesignId="";rerender=true;}pendingIdempotencyKey="";sessionStorage.removeItem("snapink.wholesale.pendingRequest");}if(rerender)renderLines();else updateSummary(); }));
    item.querySelector(".remove-line").addEventListener("click", () => { clearPendingKey();if(draftLines.length===1) draftLines=[{size:4,quantity:50,designType:"blank"}];else draftLines.splice(index,1);renderLines();updateSummary(); });
  });
  updateSummary();
}
function blankTierFor(quantity) { return config?.pricing?.blankTiers?.find(t => quantity >= t.min && (t.max == null || quantity <= t.max)) || null; }
function customTierFor(quantity) { return config?.pricing?.customTiers?.find(t => quantity >= t.min && (t.max == null || quantity <= t.max)) || null; }
function leadFor(quantity) { return config?.leadTimes?.find(t => quantity >= t.min && (t.max == null || quantity <= t.max))?.label || (quantity >= 20 ? "Lead time to be confirmed" : "Pending minimum"); }
function updateSummary() {
  const qtyFor=line=>Number.isInteger(Number(line.quantity))&&Number(line.quantity)>0?Number(line.quantity):0;
  const total=draftLines.reduce((sum,line)=>sum+qtyFor(line),0),blankQuantity=draftLines.filter(line=>line.designType==="blank").reduce((sum,line)=>sum+qtyFor(line),0),customQuantity=total-blankQuantity;
  const blankTier=blankTierFor(blankQuantity),customTier=customTierFor(customQuantity);let blankCents=0,customCents=0;
  $("summary-quantity").textContent=String(total);$("summary-blank-quantity").textContent=String(blankQuantity);$("summary-custom-quantity").textContent=String(customQuantity);
  $("summary-tier").textContent=[blankQuantity?`Blank: ${blankTier?.label||"minimum 50"}`:"No blank sleeves",customQuantity?`Custom: ${customTier?.label||"minimum 20"}`:"No custom sleeves"].join(" · ");$("summary-lead").textContent=leadFor(total);
  const rows=draftLines.map((line,index)=>{const qty=qtyFor(line),isBlank=line.designType==="blank",tier=isBlank?blankTier:customTier,unit=tier?(isBlank?(line.size<=3?tier.sizes03:tier.sizes46):tier.unitPriceCents):0,subtotal=qty*unit;if(isBlank)blankCents+=subtotal;else customCents+=subtotal;const item=$("line-items").querySelector(`[data-line="${index}"]`);if(item)item.querySelector("[data-line-price]").textContent=`${qty} × ${tier?usd(unit):"minimum not met"} = ${tier?usd(subtotal):"—"}`;const color=(config?.colors||[]).find(entry=>entry.id===line.baseColorId);return `<div class="summary-row"><span>${escape(color?.manufacturer||"Choose color")} ${escape(color?.name||"")} · ${isBlank?"Blank":"Custom"} · ${escape(line.sleeveStyle||"Billboard")} Size ${line.size} · ${qty}</span><span>${tier?usd(subtotal):"—"}</span></div>`;});
  $("summary-lines").innerHTML=rows.join("");$("summary-blank-subtotal").textContent=usd(blankCents);$("summary-custom-subtotal").textContent=usd(customCents);$("summary-subtotal").textContent=usd(blankCents+customCents);
  if($("summary-quote"))$("summary-quote").textContent="Custom printed sleeve pricing is included above. Final payable total is pending confirmation; shipping and taxes are quoted separately. No payment is collected.";
  const validMinimums=(blankQuantity===0||blankQuantity>=50)&&(customQuantity===0||customQuantity>=20);
  const valid=validMinimums&&total>0&&draftLines.every(line=>Number.isInteger(line.quantity)&&line.quantity>0&&Number.isInteger(line.size)&&line.size>=0&&line.size<=6&&line.baseColorId&&(line.designType!=="custom_branding"||line.wholesaleDesignId))&&$("wholesale-form").checkValidity();
  $("submit-order").disabled=!valid||submitting;
}
function buildKey(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;}
async function loadHistory() {
  const root=$("order-history");root.textContent="Loading requests…";
  try { const data=await api("/api/wholesale/orders");orders=data.orders||[];root.replaceChildren();if(!orders.length){root.textContent="No wholesale requests yet.";return;}
    for(const order of orders){const card=document.createElement("article");card.className="history-card";const head=document.createElement("div");head.className="history-head";const info=document.createElement("div");const title=document.createElement("h3");title.textContent=order.orderNumber;const p=document.createElement("p");p.className="muted";p.textContent=`${order.totalQuantity} sleeves · Blank ${order.blankQuantity}: ${usd(order.blankSubtotalCents)} · Custom ${order.customQuantity}: ${usd(order.customSubtotalCents)} · Total ${usd(order.merchandiseSubtotalCents)} · ${new Date(order.createdAt).toLocaleDateString()}${order.customizationQuoteStatus==="pending_quote"?" · Customization quote pending":""}`;info.append(title,p);const pill=document.createElement("span");pill.className="pill";pill.textContent=statusNames[order.status]||order.status;head.append(info,pill);const actions=document.createElement("div");actions.className="history-head";const details=document.createElement("button");details.type="button";details.className="secondary";details.textContent="Order details";const duplicate=document.createElement("button");duplicate.type="button";duplicate.className="secondary";duplicate.textContent="Duplicate as draft";const detail=document.createElement("div");detail.className="order-detail";details.addEventListener("click",async()=>{if(detail.classList.contains("open")){detail.classList.remove("open");return;}try{const d=await api(`/api/wholesale/orders?id=${encodeURIComponent(order.id)}`);detail.replaceChildren();const summary=document.createElement("p");summary.textContent=`${d.order.totalQuantity} sleeves · Blank ${d.order.blankQuantity}: ${usd(d.order.blankSubtotalCents)} · Custom ${d.order.customQuantity}: ${usd(d.order.customSubtotalCents)} · Total ${usd(d.order.merchandiseSubtotalCents)} · ${d.order.leadTimeLabel} · ${d.order.customizationQuoteStatus==="pending_quote"?"customization quote pending":"base pricing"}`;detail.append(summary);for(const line of d.items||[]){const row=document.createElement("p");row.textContent=`${line.baseColor?.manufacturer||""} ${line.baseColor?.name||""} · ${line.sleeveStyle||""} Size ${line.size}: ${line.quantity} · ${line.designType}${line.designSnapshot?.artworkColors?.length?` · artwork ${line.designSnapshot.artworkColors.map(color=>`${color.manufacturer} ${color.name}`).join(", ")}`:""}${line.designReference?` · ${line.designReference}`:""}${line.designNotes?` · ${line.designNotes}`:""}`;detail.append(row);if(line.wholesaleDesignId){const image=document.createElement("img");image.alt="Saved custom sleeve design";image.className="history-preview";detail.append(image);loadPrivateImage(image,`/api/wholesale/order-preview?id=${encodeURIComponent(line.id)}`)}}if(d.order.partnerNotes){const note=document.createElement("p");note.className="info-box";note.textContent=`SnapInk team: ${d.order.partnerNotes}`;detail.append(note)}for(const event of d.events||[]){const row=document.createElement("p");row.className="muted";row.textContent=`${statusNames[event.toStatus]||event.eventType.replaceAll("_"," ")} · ${new Date(event.createdAt).toLocaleString()}`;detail.append(row)}detail.classList.add("open");}catch(error){detail.textContent=error.message;detail.classList.add("open")}});duplicate.addEventListener("click",async()=>{try{clearPendingKey();const d=await api(`/api/wholesale/orders?id=${encodeURIComponent(order.id)}`);draftLines=(d.items||[]).map(line=>({size:line.size,quantity:line.quantity,designType:line.designType,designId:line.designId,designReference:line.designReference,designNotes:line.designNotes,sleeveStyle:line.sleeveStyle||"billboard",baseColorId:line.baseColorId||"",wholesaleDesignId:line.wholesaleDesignId||"",artworkColors:line.artworkColors||[]}));$("business-name").value=d.order.businessName;$("contact-name").value=d.order.contactName;$("contact-email").value=d.order.email;$("contact-phone").value=d.order.phone||"";$("billing-same").checked=Boolean(d.order.sameAsShipping);$("shipping-address").innerHTML=addressFields("shipping",d.order.shippingAddress);$("billing-address").innerHTML=addressFields("billing",d.order.billingAddress);syncBillingFields();$("special-instructions").value=d.order.specialInstructions||"";renderLines();$("wholesale-form").scrollIntoView({behavior:"smooth",block:"start"});message("form-message","Previous request copied to a new editable draft. Review it before submitting.");}catch(error){message("form-message",error.message,true)}});actions.append(details,duplicate);card.append(head,actions,detail);root.append(card);}
  }catch(error){root.textContent=error.message;}
}
async function loadSavedDesigns(){
  const root=$("saved-designs");if(!root)return;root.replaceChildren();
  try{
    const data=await api("/api/wholesale/designs");
    if(!data.designs?.length){root.textContent="No saved custom designs yet.";return;}
    for(const design of data.designs){
      let artworkColors=[];try{artworkColors=JSON.parse(design.artworkColorsJson||"[]")}catch{}
      const card=document.createElement("article");card.className="history-card";
      const title=document.createElement("h3");title.textContent=design.designName;
      const color=(config.colors||[]).find(entry=>entry.id===design.baseColorId);
      const info=document.createElement("p");info.className="muted";info.textContent=`${design.sleeveStyle} · Size ${design.sleeveSize} · ${color?`${color.manufacturer} ${color.name}`:"Base color no longer available"} · ${artworkColors.length+1} selected color(s)`;
      const actions=document.createElement("div");actions.className="history-head";
      const add=document.createElement("button");add.type="button";add.className="secondary";add.textContent="Add to order";add.disabled=!color;
      add.addEventListener("click",()=>{if(draftLines.length>=50)return;clearPendingKey();draftLines.push({size:design.sleeveSize,quantity:1,designType:"custom_branding",sleeveStyle:design.sleeveStyle,baseColorId:design.baseColorId,wholesaleDesignId:design.id,artworkColors});renderLines();$("wholesale-form").scrollIntoView({behavior:"smooth",block:"start"});});
      const edit=document.createElement("button");edit.type="button";edit.className="secondary";edit.textContent="Reopen in Studio";edit.disabled=!color;edit.addEventListener("click",()=>{const url=new URL("/wholesale-studio.html",location.origin);url.searchParams.set("variant",design.sleeveStyle);url.searchParams.set("size",design.sleeveSize);url.searchParams.set("color",design.baseColorId);url.searchParams.set("designId",design.id);window.open(url.href,"_blank","noopener")});
      actions.append(add,edit);const img=document.createElement("img");img.className="history-preview";img.alt=`${design.designName} private preview`;
      fetch(`/api/wholesale/design-preview?id=${encodeURIComponent(design.id)}`,{credentials:"same-origin",cache:"no-store"}).then(async response=>{if(response.status===401||response.status===403){clearPartnerSession(true);throw new Error("Partner session expired")}if(!response.ok)throw new Error("Preview unavailable");const objectUrl=URL.createObjectURL(await response.blob());img.src=objectUrl;img.addEventListener("load",()=>setTimeout(()=>URL.revokeObjectURL(objectUrl),60000),{once:true})}).catch(()=>{});
      card.append(title,info,img,actions);root.append(card);
    }
  }catch(error){root.textContent=error.message;}
}
async function enter() {
  try {
    const authorized = await api("/api/wholesale");
    config = authorized;
    const area = $("partner-area");
    area.innerHTML = partnerTemplate;
    initializePartnerApp();
    renderAuthorizedPricing();
    $("access-panel").classList.add("hidden"); area.classList.remove("hidden");
    $("partner-heading").textContent = `Welcome, ${config.partner.contactName}`;
    $("partner-profile").textContent = `${config.partner.businessName} · Approved wholesale partner`;
    $("business-name").value = config.partner.businessName || "";
    $("contact-name").value = config.partner.contactName || "";
    $("contact-email").value = config.partner.email || "";
    $("contact-phone").value = config.partner.phone || "";
    $("catalog-note").textContent = `${config.colors?.length || 0} approved enabled matte TPU colors are available. Color choices depend on current supplier stock. Custom designs require SnapInk review and are never sent to manufacturing automatically.`;
    const returned = sessionStorage.getItem("snapink.wholesale.returnDesign");
    if (returned) {
      try {
        const saved = JSON.parse(returned), line = { ...draftLines[saved.returnLine], size:saved.design.sleeveSize, quantity:draftLines[saved.returnLine]?.quantity || 1, designType:"custom_branding", sleeveStyle:saved.design.sleeveStyle, baseColorId:saved.design.baseColor.id, wholesaleDesignId:saved.design.id, sourceDesignId:"", artworkColors:saved.design.artworkColors, colorReviewRequired:saved.design.colorReviewRequired, designReference:saved.design.designName };
        if (Number.isInteger(saved.returnLine) && saved.returnLine >= 0 && saved.returnLine < draftLines.length) draftLines[saved.returnLine] = line; else draftLines.push(line);
        sessionStorage.removeItem("snapink.wholesale.returnDesign");
      } catch {}
    }
    draftLines = draftLines.map(line => ({ ...line, baseColorId:line.baseColorId || config.colors?.[0]?.id || "", sleeveStyle:line.sleeveStyle || "billboard" }));
    renderAuthorizedPricing(); renderLines();
    $("shipping-address").innerHTML = addressFields("shipping"); $("billing-address").innerHTML = addressFields("billing"); syncBillingFields();
    await loadHistory(); await loadSavedDesigns();
  } catch(error) {
    const area = $("partner-area"); if (area) { area.replaceChildren(); area.classList.add("hidden"); }
    $("access-panel").classList.remove("hidden"); message("access-message", error.message, true);
  }
}
$("access-form").addEventListener("submit", async event => {
  event.preventDefault();const button=$("access-submit");button.disabled=true;message("access-message","Checking partner access...");
  try{const response=await fetch("/api/partner-portal",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify({code:$("partner-token").value.trim()})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Access code not recognized or inactive.");$("partner-token").value="";await enter()}catch(error){message("access-message",error instanceof Error?error.message:"Access code not recognized or inactive.",true)}finally{button.disabled=false}
});
function initializePartnerApp() {
  draftLines = [{ size:4, quantity:50, designType:"blank", sleeveStyle:"billboard" }]; renderLines();
  $("sign-out").addEventListener("click", clearPartnerSession);
$("billing-same").addEventListener("change",syncBillingFields);
$("add-line").addEventListener("click",()=>{if(draftLines.length>=50)return;clearPendingKey();draftLines.push({size:4,quantity:1,designType:"blank"});renderLines();});
$("wholesale-form").addEventListener("input",()=>{clearPendingKey();updateSummary();});
$("wholesale-form").addEventListener("submit",async event=>{event.preventDefault();updateSummary();if($("submit-order").disabled||submitting)return;if(!$("wholesale-form").reportValidity())return;submitting=true;$("submit-order").disabled=true;message("form-message","Submitting your request…");
  const fd=new FormData(),key=pendingIdempotencyKey||buildKey(),lines=[];pendingIdempotencyKey=key;sessionStorage.setItem("snapink.wholesale.pendingRequest",key);draftLines.forEach((line,index)=>{const item=$("line-items").querySelector(`[data-line="${index}"]`),file=item.querySelector('[data-field="artwork"]')?.files[0]||line.artworkFile;lines.push({size:Number(line.size),quantity:Number(line.quantity),designType:line.designType,designId:line.designId||"",designReference:line.designReference||"",designNotes:line.designNotes||"",studioDesignId:"",wholesaleDesignId:line.wholesaleDesignId||"",baseColorId:line.baseColorId||"",sleeveStyle:line.sleeveStyle||"billboard",artworkColors:line.artworkColors||[]});if(file)fd.append(`artwork_${index}`,file,file.name)});
  const billingSame=$("billing-same").checked;fd.append("request",JSON.stringify({idempotencyKey:key,contact:{businessName:$("business-name").value,contactName:$("contact-name").value,email:$("contact-email").value,phone:$("contact-phone").value},shippingAddress:readAddress("shipping"),billingAddress:billingSame?null:readAddress("billing"),sameAsShipping:billingSame,specialInstructions:$("special-instructions").value,lines}));
  try{const result=await api("/api/wholesale/orders",{method:"POST",body:fd});pendingIdempotencyKey="";sessionStorage.removeItem("snapink.wholesale.pendingRequest");const order=result.order;const notice=$("confirmation");notice.classList.remove("hidden");notice.innerHTML=`<h2>Request received</h2><p><strong>${escape(order.orderNumber)}</strong> · ${Number(order.totalQuantity)} sleeves · ${usd(Number(order.merchandiseSubtotalCents))} base merchandise subtotal</p>${order.customizationQuoteStatus==="pending_quote"?"<p class=\"info-box\">Pending Quote: custom color and artwork costs are not configured in base sleeve prices. SnapInk will confirm any applicable charges before approval.</p>":""}<p>Your SnapInk wholesale order request has been received. Our team will review your quantities, customization requirements, production timeline, and shipping details before confirming your order. No payment has been collected.</p><p>Status: ${statusNames[order.status]||"Pending Review"}</p>`;notice.scrollIntoView({behavior:"smooth",block:"center"});message("form-message",result.duplicate?"This request was already received; the existing request is shown below.":"Wholesale request submitted.");$("wholesale-form").reset();draftLines=[{size:4,quantity:50,designType:"blank",baseColorId:(config.colors||[])[0]?.id||"",sleeveStyle:"billboard"}];$("billing-same").checked=true;syncBillingFields();$("shipping-address").innerHTML=addressFields("shipping");$("billing-address").innerHTML=addressFields("billing");renderLines();await loadHistory();}catch(error){message("form-message",error.message,true)}finally{submitting=false;updateSummary();}});
$("history-refresh").addEventListener("click",loadHistory);
}
enter();
