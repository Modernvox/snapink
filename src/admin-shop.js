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
  const controls=el("div",{className:"tools"});
  const productsToggle=el("button",{type:"button",className:"secondary"},"Shop products & inventory");
  const ordersToggle=el("button",{type:"button",className:"secondary"},"Shop orders");controls.append(productsToggle,ordersToggle);
  desk.querySelector("h1")?.insertAdjacentElement("afterend",controls);
  const productsPanel=el("section",{className:"panel hidden"}),ordersPanel=el("section",{className:"panel hidden"});
  productsPanel.append(el("h2",{},"Shop products, prices & inventory"),el("p",{className:"muted"},"Manage the shared size-based price schedule, active designs, variants, availability, and optional stock counts. Blank stock fields mean inventory is not tracked."));
  const productsRoot=el("div",{className:"admin-shop-products"}),productsMessage=el("p",{className:"notice",role:"status"});productsPanel.append(productsRoot,productsMessage);
  const previewDialog=el("dialog",{className:"admin-product-preview"}),previewFigure=el("figure",{}),previewCaption=el("figcaption",{}),previewClose=el("button",{type:"button",className:"secondary"},"Close preview");previewFigure.append(previewCaption);previewDialog.append(previewClose,previewFigure);productsPanel.append(previewDialog);
  previewClose.addEventListener("click",()=>previewDialog.close());previewDialog.addEventListener("click",(event)=>{if(event.target===previewDialog)previewDialog.close()});
  ordersPanel.append(el("h2",{},"Exclusive Shop orders"),el("p",{className:"muted"},"Payments become PAID only after the signed Stripe webhook confirms the amount, tax, currency, and session."));
  const orderTools=el("div",{className:"tools"}),search=el("input",{type:"search",placeholder:"Search Shop order, customer, email"}),refresh=el("button",{type:"button",className:"secondary"},"Refresh Shop orders");orderTools.append(search,refresh);const ordersMessage=el("p",{className:"notice",role:"status"}),tableWrap=el("div",{className:"table-wrap"}),table=el("table",{className:"orders"}),thead=el("thead"),headRow=el("tr");for(const label of ["Order / customer","Items","Payment / total","Shipping details","Fulfillment","Actions"])headRow.append(el("th",{},label));thead.append(headRow);const tbody=el("tbody");table.append(thead,tbody);tableWrap.append(table);ordersPanel.append(orderTools,ordersMessage,tableWrap);desk.append(productsPanel,ordersPanel);
  productsToggle.addEventListener("click",async()=>{productsPanel.classList.toggle("hidden");ordersPanel.classList.add("hidden");if(!productsPanel.classList.contains("hidden"))await renderProducts()});
  ordersToggle.addEventListener("click",async()=>{ordersPanel.classList.toggle("hidden");productsPanel.classList.add("hidden");if(!ordersPanel.classList.contains("hidden"))await renderOrders()});

  async function renderProducts(){
    productsRoot.replaceChildren();productsMessage.textContent="Loading product catalog...";productsMessage.className="notice";
    try{
      const {data}=await api("/api/admin/shop-products"),products=data.products||[];productsMessage.textContent="";
      if(!products.length){productsMessage.textContent="No products are configured yet.";return}
      const images=[...new Map(products.flatMap((product)=>[
        {url:product.imageUrl,label:`${product.name} storefront image`},
        ...(product.variants||[]).map((variant)=>({url:variant.sleeveImageUrl,label:`${product.name} — ${variant.name} sleeve-only image`}))
      ]).filter((image)=>image.url).map((image)=>[image.url,image])).values()];

      const pricing=el("section",{className:"admin-shop-global"}),pricingHeading=el("div",{className:"admin-shop-global-heading"}),pricingTitle=el("h3",{},"Global Sleeve Pricing"),pricingCopy=el("p",{},"One shared USD price schedule applies across all Shop designs.");pricingHeading.append(pricingTitle,pricingCopy);
      const priceGrid=el("div",{className:"admin-shop-price-grid"}),priceInputs=[];
      products[0].prices.forEach((cents,size)=>{const label=el("label",{className:"admin-shop-field"},`Size ${size} price (USD)`),input=el("input",{type:"number",inputMode:"decimal",min:"0.01",max:"1000",step:"0.01",value:(cents/100).toFixed(2)});label.append(input);priceGrid.append(label);priceInputs.push(input)});
      const priceSave=el("button",{type:"button"},"Save global prices"),priceFeedback=el("span",{className:"admin-shop-inline-status","aria-live":"polite"}),priceActions=el("div",{className:"admin-shop-pricing-actions"});priceActions.append(priceSave,priceFeedback);pricing.append(pricingHeading,priceGrid,priceActions);
      priceSave.addEventListener("click",async()=>{priceSave.disabled=true;priceFeedback.textContent="Saving...";priceFeedback.className="admin-shop-inline-status";try{
        const values=priceInputs.map((input)=>Math.round(Number(input.value)*100));if(values.some((value)=>!Number.isSafeInteger(value)||value<1))throw new Error("Enter a valid USD price for each size.");
        await api("/api/admin/shop-products",{method:"PATCH",body:JSON.stringify({productId:products[0].productId,prices:values})});
        for(const product of products)product.prices=values.slice();for(const card of productsRoot.querySelectorAll(".admin-shop-product-card"))card.querySelector(".admin-shop-starting-price").textContent=`Starting at ${money(Math.min(...values))}`;
        priceFeedback.textContent="Global prices saved.";priceFeedback.classList.add("success");
      }catch(error){priceFeedback.textContent=error.message;priceFeedback.classList.add("error")}finally{priceSave.disabled=false}});
      productsRoot.append(pricing);

      for(const product of products){
        const card=el("article",{className:"admin-shop-product-card"}),header=el("div",{className:"admin-shop-product-header"}),thumbButton=el("button",{type:"button",className:"admin-shop-thumb-button","aria-label":`Preview ${product.name} image`}),thumb=el("img",{className:"admin-shop-thumb",alt:product.imageAlt||`${product.name} SnapInk Sleeve product`});setImageOrPlaceholder(thumb,product.imageUrl,product.imageAlt);thumbButton.append(thumb);
        const openPreview=()=>showProductPreview(previewDialog,product.imageUrl,product.imageAlt,product.name);thumbButton.addEventListener("click",openPreview);
        const identity=el("div",{className:"admin-shop-product-identity"}),nameRow=el("div",{className:"admin-shop-name-row"}),name=el("h3",{},product.name),status=el("span",{className:`admin-shop-status ${product.active?"is-active":"is-inactive"}`},product.active?"Active":"Inactive");nameRow.append(name,status);
        const activeLabel=el("label",{className:"admin-shop-toggle"}),active=el("input",{type:"checkbox","aria-label":`Activate ${product.name}`});active.checked=Boolean(product.active);activeLabel.append(active,el("span",{},"Product active"));identity.append(nameRow,activeLabel,el("p",{className:"admin-shop-starting-price"},`Starting at ${money(Math.min(...product.prices))}`));
        const expand=el("button",{type:"button",className:"secondary admin-shop-expand","aria-expanded":"false"},"Settings +");header.append(thumbButton,identity,expand);card.append(header);
        const settings=el("div",{className:"admin-shop-settings"});settings.hidden=true;
        const settingsHeading=el("div",{className:"admin-shop-settings-title"});settingsHeading.append(el("h4",{},`${product.name} settings`),el("p",{},"Your edits stay in place while you expand or collapse. Save to apply them."));settings.append(settingsHeading);

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

        const save=el("button",{type:"button",className:"admin-shop-save"},"Save product settings"),feedback=el("span",{className:"admin-shop-inline-status","aria-live":"polite"}),saveActions=el("div",{className:"admin-shop-save-actions"});saveActions.append(save,feedback);settings.append(saveActions);card.append(settings);
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
    tbody.replaceChildren();ordersMessage.textContent="Loading Shop ordersâ€¦";
    try{
      const query=new URLSearchParams();if(search.value.trim())query.set("q",search.value.trim());const {data}=await api(`/api/admin/shop-orders?${query}`);ordersMessage.textContent=data.orders?.length?"":"No Shop orders yet.";
      for(const order of data.orders||[]){
        const tr=el("tr"),buyer=el("td"),buyerName=el("strong",{},`${order.orderNumber} Â· ${order.customerName}`),buyerEmail=el("p",{},order.customerEmail);buyer.append(buyerName,buyerEmail);tr.append(buyer);
        const items=el("td");for(const item of order.items||[])items.append(el("div",{},`${item.quantity} Ã— ${item.name} / ${item.variantName} / Size ${item.size} Â· ${money(item.lineSubtotalCents)}`));tr.append(items);
        const total=el("td"),status=el("span",{className:"pill"},order.status),breakdown=el("p",{},`Subtotal ${money(order.merchandiseSubtotalCents)} Â· Discount âˆ’${money(order.discountCents)} Â· Shipping ${money(order.shippingCents)} Â· Tax ${money(order.taxCents)} Â· Paid ${money(order.totalPaidCents)}`);total.append(status,breakdown);tr.append(total);
        const address=order.shippingAddress||{},ship=el("td",{},`${order.customerPhone||""}\n${address.line1||""} ${address.line2||""}\n${address.city||""}, ${address.region||""} ${address.postalCode||""} ${address.country||""}\n${order.carrier||""} ${order.trackingNumber||""}`);ship.style.whiteSpace="pre-wrap";tr.append(ship);
        const fulfillment=el("td");const next=({PAID:"IN_PRODUCTION",IN_PRODUCTION:"SHIPPED",SHIPPED:"COMPLETED"})[order.status];fulfillment.textContent=next||"â€”";if(order.status==="IN_PRODUCTION"){const carrier=el("input",{type:"text",placeholder:"Carrier",maxLength:"80",value:order.carrier||""}),tracking=el("input",{type:"text",placeholder:"Tracking number",maxLength:"120",value:order.trackingNumber||""});fulfillment.append(carrier,tracking);fulfillment.dataset.carrier="";fulfillment.append(el("span",{},"Carrier and tracking required to mark shipped."));fulfillment._carrier=carrier;fulfillment._tracking=tracking}tr.append(fulfillment);
        const actions=el("td");if(next){const button=el("button",{type:"button"},`Mark ${next.replaceAll("_"," ")}`);button.addEventListener("click",async()=>{button.disabled=true;ordersMessage.textContent=`Updating ${order.orderNumber}â€¦`;try{const carrier=fulfillment._carrier?.value||"",trackingNumber=fulfillment._tracking?.value||"";const {data:result}=await api("/api/admin/shop-orders",{method:"PATCH",body:JSON.stringify({id:order.id,action:"set_fulfillment",status:next,carrier,trackingNumber})});ordersMessage.textContent=`${result.orderNumber}: ${result.status}; customer email ${result.emailStatus}.`;await renderOrders()}catch(error){ordersMessage.textContent=error.message;ordersMessage.className="notice error";button.disabled=false}});actions.append(button)}
        tr.append(actions);tbody.append(tr);
      }
    }catch(error){ordersMessage.textContent=error.message;ordersMessage.className="notice error"}
  }
  refresh.addEventListener("click",renderOrders);let timer;search.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(renderOrders,250)});
  return{load:async()=>{if(!productsPanel.classList.contains("hidden"))await renderProducts();if(!ordersPanel.classList.contains("hidden"))await renderOrders()}};
}
