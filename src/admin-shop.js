import "./admin-shop.css";

const el=(tag,attrs={},text="")=>{const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs))if(key==="className")node.className=value;else node.setAttribute(key,value);if(text)node.textContent=text;return node};
const money=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(cents||0)/100);

function setImageOrPlaceholder(image,src,alt){
  image.src=src||"";image.alt=alt||"SnapInk product image";image.onerror=()=>{const placeholder=el("span",{className:"admin-product-image-placeholder","aria-label":"Product image unavailable"},"Image unavailable");image.replaceWith(placeholder)};
}

function showProductPreview(dialog,imageUrl,alt,name){
  const figure=dialog.querySelector("figure"),caption=figure.querySelector("figcaption");
  figure.querySelector("img")?.remove();figure.querySelector(".admin-product-image-placeholder")?.remove();
  const image=el("img",{alt:alt||`${name} product preview`});figure.insertBefore(image,caption);setImageOrPlaceholder(image,imageUrl,alt||`${name} product preview`);caption.textContent=name;
  if(typeof dialog.showModal==="function")dialog.showModal();
}

export function mountAdminShop(api){
  const desk=document.querySelector("#desk");if(!desk)return{load:async()=>{}};
  const controls=el("div",{className:"tools admin-shop-toggle-tools"});
  const productsToggle=el("button",{type:"button",className:"secondary"},"Shop products & inventory");
  const ordersToggle=el("button",{type:"button",className:"secondary"},"Shop orders");controls.append(productsToggle,ordersToggle);
  desk.querySelector("h1")?.insertAdjacentElement("afterend",controls);
  const productsPanel=el("section",{className:"panel hidden"}),ordersPanel=el("section",{className:"panel hidden"});productsPanel.id="shop-products-panel";ordersPanel.id="shop-orders-panel";
  productsPanel.append(el("h2",{},"Shop products, prices & inventory"),el("p",{className:"muted"},"Manage the shared size-based price schedule, active designs, variants, availability, and optional stock counts. Blank stock fields mean inventory is not tracked."));
  const thumbnailTools=el("div",{className:"tools"}),backfillThumbnails=el("button",{type:"button",className:"secondary"},"Backfill Shop gallery thumbnails");thumbnailTools.append(backfillThumbnails);productsPanel.append(thumbnailTools);
  const productsRoot=el("div",{className:"admin-shop-products"}),productsMessage=el("p",{className:"notice",role:"status"});productsPanel.append(productsRoot,productsMessage);
  const previewDialog=el("dialog",{className:"admin-product-preview"}),previewFigure=el("figure",{}),previewCaption=el("figcaption",{}),previewClose=el("button",{type:"button",className:"secondary"},"Close preview");previewFigure.append(previewCaption);previewDialog.append(previewClose,previewFigure);productsPanel.append(previewDialog);
  previewClose.addEventListener("click",()=>previewDialog.close());previewDialog.addEventListener("click",(event)=>{if(event.target===previewDialog)previewDialog.close()});
  ordersPanel.append(el("h2",{},"Exclusive Shop orders"),el("p",{className:"muted"},"Payments become PAID only after the signed Stripe webhook confirms the amount, tax, currency, and session."));
  const orderTools=el("div",{className:"tools"}),search=el("input",{type:"search",placeholder:"Search Shop order, customer, email"}),refresh=el("button",{type:"button",className:"secondary"},"Refresh Shop orders");orderTools.append(search,refresh);const ordersMessage=el("p",{className:"notice",role:"status"}),tableWrap=el("div",{className:"table-wrap"}),table=el("table",{className:"orders"}),thead=el("thead"),headRow=el("tr");for(const label of ["Order / customer","Items","Payment / total","Shipping details","Fulfillment","Actions"])headRow.append(el("th",{},label));thead.append(headRow);const tbody=el("tbody");table.append(thead,tbody);tableWrap.append(table);ordersPanel.append(orderTools,ordersMessage,tableWrap);desk.append(productsPanel,ordersPanel);
  productsToggle.addEventListener("click",async()=>{productsPanel.classList.remove("hidden");ordersPanel.classList.add("hidden");await renderProducts()});
  ordersToggle.addEventListener("click",async()=>{ordersPanel.classList.remove("hidden");productsPanel.classList.add("hidden");await renderOrders()});
  backfillThumbnails.addEventListener("click",backfillShopThumbnails);

  async function backfillShopThumbnails(){
    backfillThumbnails.disabled=true;productsMessage.textContent="Preparing existing product gallery thumbnails…";productsMessage.className="notice";
    try{
      const {data}=await api("/api/admin/shop-products"),images=new Map();
      for(const product of data.products||[])for(const image of [{url:product.imageUrl},...(product.gallery||[])]){
        if(!image.url)continue;
        const url=new URL(image.url,location.origin),key=url.pathname==="/api/shop/product-image"?url.searchParams.get("key"):null;
        if(key&&/^shop-products\/studio-[a-f0-9-]{36}\/(?:[1-5]|on-hat|packaging|on-desk)\.png$/.test(key))images.set(key,image.url);
      }
      if(!images.size){productsMessage.textContent="No stored Studio gallery images need thumbnails.";return}
      const upload=new FormData();
      for(const [key,source] of images){
        const response=await fetch(source,{cache:"force-cache"});if(!response.ok)throw new Error(`Could not load a stored product image (${response.status}).`);
        const bitmap=await createImageBitmap(await response.blob()),scale=Math.min(1,480/bitmap.width),canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext("2d");if(!context){bitmap.close();throw new Error("Thumbnail canvas is unavailable.")}
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
        const thumbnail=await new Promise((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error("Thumbnail encoding failed.")),"image/webp",0.96));
        if(thumbnail.type!=="image/webp")throw new Error("WebP thumbnail encoding is unavailable.");
        upload.append("imageKeys",key);upload.append("thumbnails",thumbnail,key.split("/").pop().replace(/\.png$/,".webp"));
      }
      const {data:result}=await api("/api/admin/shop-product-thumbnails",{method:"POST",body:upload});
      productsMessage.textContent=`Backfilled ${result.thumbnailCount} existing Shop gallery thumbnails. Product images and records were left unchanged.`;productsMessage.className="notice success";
    }catch(error){productsMessage.textContent=error.message||"Could not backfill Shop gallery thumbnails.";productsMessage.className="notice error"}
    finally{backfillThumbnails.disabled=false}
  }

  async function renderProducts(statusMessage="",statusIsError=false){
    productsRoot.replaceChildren();productsMessage.textContent="Loading product catalog...";productsMessage.className="notice";
    try{
      const {data}=await api("/api/admin/shop-products"),products=data.products||[];productsMessage.textContent=statusMessage;productsMessage.className=statusMessage?`notice ${statusIsError?"error":"success"}`:"notice";
      if(!products.length){productsMessage.textContent=statusMessage||"No products are configured yet.";return}
      const images=[...new Map(products.flatMap((product)=>[
        {url:product.imageUrl,label:`${product.name} storefront image`},
        ...(product.variants||[]).map((variant)=>({url:variant.sleeveImageUrl,label:`${product.name} — ${variant.name} sleeve-only image`}))
      ]).filter((image)=>image.url).map((image)=>[image.url,image])).values()];

      const standardPricingProduct=products.find((product)=>product.artworkTier==="standard");
      const pricing=el("section",{className:"admin-shop-global"}),pricingHeading=el("div",{className:"admin-shop-global-heading"}),pricingTitle=el("h3",{},"Standard Sleeve Pricing"),pricingCopy=el("p",{},"This USD price schedule applies to Standard products and products awaiting artwork review.");pricingHeading.append(pricingTitle,pricingCopy);
      const priceGrid=el("div",{className:"admin-shop-price-grid"}),priceInputs=[];
      (standardPricingProduct?.prices||[1599,1599,1599,1599,1899,1899]).forEach((cents,size)=>{const label=el("label",{className:"admin-shop-field"},`Size ${size} price (USD)`),input=el("input",{type:"number",inputMode:"decimal",min:"0.01",max:"1000",step:"0.01",value:(cents/100).toFixed(2)});label.append(input);priceGrid.append(label);priceInputs.push(input)});
      const priceSave=el("button",{type:"button"},"Save global prices"),priceFeedback=el("span",{className:"admin-shop-inline-status","aria-live":"polite"}),priceActions=el("div",{className:"admin-shop-pricing-actions"});priceActions.append(priceSave,priceFeedback);pricing.append(pricingHeading,priceGrid,priceActions);
      priceSave.addEventListener("click",async()=>{priceSave.disabled=true;priceFeedback.textContent="Saving...";priceFeedback.className="admin-shop-inline-status";try{
        const values=priceInputs.map((input)=>Math.round(Number(input.value)*100));if(values.some((value)=>!Number.isSafeInteger(value)||value<1))throw new Error("Enter a valid USD price for each size.");
        if(!standardPricingProduct)throw new Error("A Standard product must be configured before updating Standard pricing.");
        await api("/api/admin/shop-products",{method:"PATCH",body:JSON.stringify({productId:standardPricingProduct.productId,prices:values})});
        for(const product of products)if(product.artworkTier!=="premium")product.prices=values.slice();for(const card of productsRoot.querySelectorAll(".admin-shop-product-card")){const product=products.find((entry)=>entry.productId===card.dataset.productId);if(product)card.querySelector(".admin-shop-starting-price").textContent=`Starting at ${money(Math.min(...product.prices))}`}
        priceFeedback.textContent="Standard prices saved.";priceFeedback.classList.add("success");
      }catch(error){priceFeedback.textContent=error.message;priceFeedback.classList.add("error")}finally{priceSave.disabled=false}});
      productsRoot.append(pricing);

      for(const product of products){
        const card=el("article",{className:"admin-shop-product-card"});card.dataset.productId=product.productId;const header=el("div",{className:"admin-shop-product-header"}),thumbButton=el("button",{type:"button",className:"admin-shop-thumb-button","aria-label":`Preview ${product.name} image`}),thumb=el("img",{className:"admin-shop-thumb",alt:product.imageAlt||`${product.name} SnapInk Sleeve product`});setImageOrPlaceholder(thumb,product.imageUrl,product.imageAlt);thumbButton.append(thumb);
        const openPreview=()=>showProductPreview(previewDialog,product.imageUrl,product.imageAlt,product.name);thumbButton.addEventListener("click",openPreview);
        const identity=el("div",{className:"admin-shop-product-identity"}),nameRow=el("div",{className:"admin-shop-name-row"}),name=el("h3",{},product.name),status=el("span",{className:`admin-shop-status ${product.active?"is-active":"is-inactive"}`},product.active?"Active":"Inactive");nameRow.append(name,status);if(product.artworkTier==="review")nameRow.append(el("span",{className:"admin-shop-status is-review"},"Artwork tier review"));else nameRow.append(el("span",{className:"admin-shop-status"},product.artworkTier==="premium"?"Premium Extended Artwork":"Standard artwork"));
        const activeLabel=el("label",{className:"admin-shop-toggle"}),active=el("input",{type:"checkbox","aria-label":`Activate ${product.name}`});active.checked=Boolean(product.active);activeLabel.append(active,el("span",{},"Product active"));identity.append(nameRow,activeLabel,el("p",{className:"admin-shop-starting-price"},`Starting at ${money(Math.min(...product.prices))}`));
        const expand=el("button",{type:"button",className:"secondary admin-shop-expand","aria-expanded":"false"},"Settings +");header.append(thumbButton,identity,expand);card.append(header);
        const settings=el("div",{className:"admin-shop-settings"});settings.hidden=true;
        const settingsHeading=el("div",{className:"admin-shop-settings-title"});settingsHeading.append(el("h4",{},`${product.name} settings`),el("p",{},"Your edits stay in place while you expand or collapse. Save to apply them."));settings.append(settingsHeading);

        const artworkTierSection=el("section",{className:"admin-shop-classification"}),artworkTierHeading=el("h5",{},"Artwork pricing classification"),artworkTierHelp=el("p",{},product.artworkTier==="review"?"This older product has no saved admin classification. Choose Standard or Premium Extended Artwork after reviewing its production details.":"The saved classification controls product pricing and customer-facing extended artwork language."),artworkTierLabel=el("label",{className:"admin-shop-field"},"Product artwork tier"),artworkTierSelect=el("select",{"aria-label":`Artwork pricing classification for ${product.name}`});
        if(product.artworkTier==="review")artworkTierSelect.append(el("option",{value:"review"},"Needs manual review"));artworkTierSelect.append(el("option",{value:"standard"},"Standard"),el("option",{value:"premium"},"Premium Extended Artwork"));artworkTierSelect.value=product.artworkTier||"review";artworkTierLabel.append(artworkTierSelect);
        const artworkTierSave=el("button",{type:"button",className:"secondary"},"Save artwork classification"),artworkTierFeedback=el("span",{className:"admin-shop-inline-status","aria-live":"polite"});artworkTierSave.disabled=product.artworkTier===artworkTierSelect.value||artworkTierSelect.value==="review";artworkTierSelect.addEventListener("change",()=>artworkTierSave.disabled=artworkTierSelect.value===product.artworkTier||artworkTierSelect.value==="review");artworkTierSave.addEventListener("click",async()=>{artworkTierSave.disabled=true;artworkTierFeedback.textContent="Saving classification...";try{await api("/api/admin/shop-products",{method:"PATCH",body:JSON.stringify({productId:product.productId,artworkTier:artworkTierSelect.value})});await renderProducts(`${product.name} is now ${artworkTierSelect.value==="premium"?"Premium Extended Artwork":"Standard"}; pricing and descriptions were updated.`)}catch(error){artworkTierFeedback.textContent=error.message;artworkTierFeedback.className="admin-shop-inline-status error";artworkTierSave.disabled=false}});
        const productionDetails=el("details",{className:"admin-shop-production-details"}),productionSummary=el("summary",{},"Internal production measurements"),productionData=el("pre",{},JSON.stringify(product.productionMetadata||{},null,2));productionDetails.append(productionSummary,productionData);artworkTierSection.append(artworkTierHeading,artworkTierHelp,artworkTierLabel,artworkTierSave,artworkTierFeedback,productionDetails);settings.append(artworkTierSection);

        const imageSection=el("section",{className:"admin-shop-image-settings"}),imageHeadingRow=el("div",{className:"admin-shop-image-heading"}),imageHeading=el("h5",{},"Product image"),changeImage=el("button",{type:"button",className:"secondary admin-shop-change-image"},"Change Image"),imageHelp=el("p",{className:"admin-shop-help"},"Choose an image already configured in the catalog, or enter a deployed /images/product_images/ path. The existing R2 bucket is private and is not used for storefront images.");imageHeadingRow.append(imageHeading,changeImage);changeImage.addEventListener("click",()=>imageSelect.focus());
        const imageSelectLabel=el("label",{className:"admin-shop-field"},"Choose existing image"),imageSelect=el("select",{"aria-label":`Choose ${product.name} product image`});
        for(const image of images){const option=el("option",{value:image.url},image.label);option.selected=image.url===product.imageUrl;imageSelect.append(option)}
        imageSelect.append(el("option",{value:"__custom__"},"Enter another public image path..."));imageSelectLabel.append(imageSelect);
        const customImageLabel=el("label",{className:"admin-shop-field admin-shop-custom-image"},"Public image path"),imagePath=el("input",{type:"text",inputMode:"url",placeholder:"/images/product_images/new-design.png",maxLength:"500",value:product.imageUrl||""}),imageAltLabel=el("label",{className:"admin-shop-field"},"Image description (alt text)"),imageAlt=el("input",{type:"text",maxLength:"300",value:product.imageAlt||"",placeholder:"Describe this SnapInk Sleeve image"});customImageLabel.append(imagePath);imageAltLabel.append(imageAlt);imageSection.append(imageHeadingRow,imageHelp,imageSelectLabel,customImageLabel,imageAltLabel);settings.append(imageSection);
        const updateImagePreview=()=>{const source=imageSelect.value==="__custom__"?imagePath.value.trim():imageSelect.value;product.imageUrl=source;product.imageAlt=imageAlt.value.trim();const nextImage=el("img",{className:"admin-shop-thumb",alt:product.imageAlt||`${product.name} SnapInk Sleeve product`});setImageOrPlaceholder(nextImage,source,product.imageAlt);thumbButton.replaceChildren(nextImage);thumbButton.setAttribute("aria-label",`Preview ${product.name} image`)};
        imageSelect.addEventListener("change",()=>{customImageLabel.hidden=imageSelect.value!=="__custom__";updateImagePreview()});imagePath.addEventListener("input",updateImagePreview);imageAlt.addEventListener("input",updateImagePreview);
        if(!images.some((image)=>image.url===product.imageUrl))imageSelect.value="__custom__";customImageLabel.hidden=imageSelect.value!=="__custom__";

        const variantControls=[];
        for(const variant of product.variants||[]){
          const section=el("section",{className:"admin-shop-variant"}),variantHeader=el("div",{className:"admin-shop-variant-heading"}),variantName=el("h5",{},variant.name),variantActiveLabel=el("label",{className:"admin-shop-toggle"}),variantActive=el("input",{type:"checkbox","aria-label":`Activate ${product.name} ${variant.name}`});variantActive.checked=Boolean(variant.active);variantActiveLabel.append(variantActive,el("span",{},"Variant active"));variantHeader.append(variantName,variantActiveLabel);section.append(variantHeader);
          const sizeGrid=el("div",{className:"admin-shop-size-grid"}),inventoryMap=new Map((variant.inventory||[]).map((entry)=>[Number(entry.size),Number(entry.availableQuantity)])),sizeControls=[];
          for(let size=0;size<=5;size++){
            const sizeCard=el("div",{className:"admin-shop-size-card"}),availableLabel=el("label",{className:"admin-shop-availability"}),available=el("input",{type:"checkbox","aria-label":`Size ${size} available for ${product.name}`});available.checked=(variant.availableSizes||[]).includes(size);availableLabel.append(available,el("span",{},`Size ${size} available`));
            const stockLabel=el("label",{className:"admin-shop-field"},"Stock quantity"),stock=el("input",{type:"number",min:"0",max:"100000",step:"1",inputMode:"numeric",placeholder:"Untracked","aria-label":`Size ${size} stock for ${product.name}`}),inventoryStatus=el("span",{className:"admin-shop-inventory-status"});if(inventoryMap.has(size))stock.value=String(inventoryMap.get(size));inventoryStatus.textContent=stock.value===""?"Inventory not tracked":"Stock tracked";stock.addEventListener("input",()=>inventoryStatus.textContent=stock.value===""?"Inventory not tracked":"Stock tracked");stockLabel.append(stock);sizeCard.append(el("strong",{},`Size ${size}`),availableLabel,stockLabel,inventoryStatus);sizeGrid.append(sizeCard);sizeControls.push({size,available,stock});
          }
          section.append(sizeGrid);settings.append(section);variantControls.push({variant,variantActive,sizeControls});
        }

        const save=el("button",{type:"button",className:"admin-shop-save"},"Save product settings"),deleteProduct=el("button",{type:"button",className:"admin-shop-delete"},"Delete Product"),feedback=el("span",{className:"admin-shop-inline-status","aria-live":"polite"}),saveActions=el("div",{className:"admin-shop-save-actions"});saveActions.append(save,deleteProduct,feedback);settings.append(saveActions);card.append(settings);
        deleteProduct.addEventListener("click",async()=>{
          if(!window.confirm(`Permanently delete “${product.name}”? This removes the product from the Shop and admin inventory.`))return;
          deleteProduct.disabled=true;feedback.textContent="Deleting product...";feedback.className="admin-shop-inline-status";
          try{
            const {data}=await api("/api/admin/shop-products",{method:"DELETE",body:JSON.stringify({productId:product.productId})});
            const warning=data.cleanupWarning?` ${data.cleanupWarning}`:"";
            await renderProducts(`Product “${data.productName||product.name}” permanently deleted.${warning}`,Boolean(warning));
          }catch(error){feedback.textContent=error.message;feedback.className="admin-shop-inline-status error";deleteProduct.disabled=false}
        });
        active.addEventListener("change",()=>{status.textContent=active.checked?"Active":"Inactive";status.className=`admin-shop-status ${active.checked?"is-active":"is-inactive"}`});
        expand.addEventListener("click",()=>{const open=settings.hidden;settings.hidden=!open;expand.setAttribute("aria-expanded",String(open));expand.textContent=open?"Close settings −":"Settings +"});
        save.addEventListener("click",async()=>{save.disabled=true;feedback.textContent="Saving...";feedback.className="admin-shop-inline-status";try{
          const source=imageSelect.value==="__custom__"?imagePath.value.trim():imageSelect.value;
          if(!source)throw new Error("Choose or enter a product image path.");if(!imageAlt.value.trim())throw new Error("Add descriptive alt text for the product image.");
          for(const {variant,variantActive,sizeControls} of variantControls){
            const update={productId:product.productId,active:active.checked,imageUrl:source,imageAlt:imageAlt.value.trim(),variantId:variant.variantId,variantActive:variantActive.checked,availableSizes:sizeControls.flatMap((control)=>control.available.checked?[control.size]:[]),inventory:sizeControls.map((control)=>({variantId:variant.variantId,size:control.size,quantity:control.stock.value===""?null:Number(control.stock.value)}))};
            await api("/api/admin/shop-products",{method:"PATCH",body:JSON.stringify(update)});
          }
          if(!variantControls.length)await api("/api/admin/shop-products",{method:"PATCH",body:JSON.stringify({productId:product.productId,active:active.checked,imageUrl:source,imageAlt:imageAlt.value.trim()})});
          product.active=active.checked;product.imageUrl=source;product.imageAlt=imageAlt.value.trim();feedback.textContent="Saved successfully.";feedback.classList.add("success");save.textContent="Saved";status.textContent=product.active?"Active":"Inactive";status.className=`admin-shop-status ${product.active?"is-active":"is-inactive"}`;
        }catch(error){feedback.textContent=variantControls.length>1?`${error.message} Earlier variant settings may already have saved; review them before retrying.`:error.message;feedback.classList.add("error")}finally{save.disabled=false}});
        productsRoot.append(card);
      }
    }catch(error){productsMessage.textContent=error.message;productsMessage.className="notice error"}
  }

  async function renderOrders(){
    tbody.replaceChildren();ordersMessage.textContent="Loading Shop orders…";
    try{
      const query=new URLSearchParams();if(search.value.trim())query.set("q",search.value.trim());const {data}=await api(`/api/admin/shop-orders?${query}`);ordersMessage.textContent=data.orders?.length?"":"No Shop orders yet.";
      for(const order of data.orders||[]){
        const tr=el("tr"),buyer=el("td"),buyerName=el("strong",{},`${order.orderNumber} · ${order.customerName}`),buyerEmail=el("p",{},order.customerEmail);buyer.append(buyerName,buyerEmail);tr.append(buyer);
        const items=el("td");for(const item of order.items||[])items.append(el("div",{},`${item.quantity} × ${item.name} / ${item.variantName} / Size ${item.size} · ${money(item.lineSubtotalCents)}`));tr.append(items);
        const total=el("td"),status=el("span",{className:"pill"},order.status),breakdown=el("p",{},`Subtotal ${money(order.merchandiseSubtotalCents)} · Discount −${money(order.discountCents)} · Shipping ${money(order.shippingCents)} · Tax ${money(order.taxCents)} · Paid ${money(order.totalPaidCents)}`);total.append(status,breakdown);tr.append(total);
        const address=order.shippingAddress||{},ship=el("td",{},`${order.customerPhone||""}\n${address.line1||""} ${address.line2||""}\n${address.city||""}, ${address.region||""} ${address.postalCode||""} ${address.country||""}\n${order.carrier||""} ${order.trackingNumber||""}`);ship.style.whiteSpace="pre-wrap";tr.append(ship);
        const fulfillment=el("td");const next=({PAID:"IN_PRODUCTION",IN_PRODUCTION:"SHIPPED",SHIPPED:"COMPLETED"})[order.status];fulfillment.textContent=next||"—";if(order.status==="IN_PRODUCTION"){const carrier=el("input",{type:"text",placeholder:"Carrier",maxLength:"80",value:order.carrier||""}),tracking=el("input",{type:"text",placeholder:"Tracking number",maxLength:"120",value:order.trackingNumber||""});fulfillment.append(carrier,tracking);fulfillment.dataset.carrier="";fulfillment.append(el("span",{},"Carrier and tracking required to mark shipped."));fulfillment._carrier=carrier;fulfillment._tracking=tracking}tr.append(fulfillment);
        const actions=el("td");if(next){const button=el("button",{type:"button"},`Mark ${next.replaceAll("_"," ")}`);button.addEventListener("click",async()=>{button.disabled=true;ordersMessage.textContent=`Updating ${order.orderNumber}…`;try{const carrier=fulfillment._carrier?.value||"",trackingNumber=fulfillment._tracking?.value||"";const {data:result}=await api("/api/admin/shop-orders",{method:"PATCH",body:JSON.stringify({id:order.id,action:"set_fulfillment",status:next,carrier,trackingNumber})});ordersMessage.textContent=`${result.orderNumber}: ${result.status}; customer email ${result.emailStatus}.`;await renderOrders()}catch(error){ordersMessage.textContent=error.message;ordersMessage.className="notice error";button.disabled=false}});actions.append(button)}
        tr.append(actions);tbody.append(tr);
      }
    }catch(error){ordersMessage.textContent=error.message;ordersMessage.className="notice error"}
  }
  refresh.addEventListener("click",renderOrders);let timer;search.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(renderOrders,250)});
  return{load:async()=>{},showProducts:async()=>{productsToggle.click()},showOrders:async()=>{ordersToggle.click()}};
}
