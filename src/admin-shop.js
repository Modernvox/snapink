const el=(tag,attrs={},text="")=>{const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs))if(key==="className")node.className=value;else node.setAttribute(key,value);if(text)node.textContent=text;return node};
const money=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(cents||0)/100);

export function mountAdminShop(api){
  const desk=document.querySelector("#desk");if(!desk)return{load:async()=>{}};
  const controls=el("div",{className:"tools"});
  const productsToggle=el("button",{type:"button",className:"secondary"},"Shop products & inventory");
  const ordersToggle=el("button",{type:"button",className:"secondary"},"Shop orders");controls.append(productsToggle,ordersToggle);
  desk.querySelector("h1")?.insertAdjacentElement("afterend",controls);
  const productsPanel=el("section",{className:"panel hidden"}),ordersPanel=el("section",{className:"panel hidden"});
  productsPanel.append(el("h2",{},"Shop products, prices & inventory"),el("p",{className:"muted"},"Manage the shared six-size price schedule, product activation, available variants, size availability, and optional stock counts. Empty stock fields mean inventory is not tracked."));
  const productsRoot=el("div",{className:"wholesale-cards"}),productsMessage=el("p",{className:"notice",role:"status"});productsPanel.append(productsRoot,productsMessage);
  ordersPanel.append(el("h2",{},"Exclusive Shop orders"),el("p",{className:"muted"},"Payments become PAID only after the signed Stripe webhook confirms the amount, tax, currency, and session."));
  const orderTools=el("div",{className:"tools"}),search=el("input",{type:"search",placeholder:"Search Shop order, customer, email"}),refresh=el("button",{type:"button",className:"secondary"},"Refresh Shop orders");orderTools.append(search,refresh);const ordersMessage=el("p",{className:"notice",role:"status"}),tableWrap=el("div",{className:"table-wrap"}),table=el("table",{className:"orders"}),thead=el("thead"),headRow=el("tr");for(const label of ["Order / customer","Items","Payment / total","Shipping details","Fulfillment","Actions"])headRow.append(el("th",{},label));thead.append(headRow);const tbody=el("tbody");table.append(thead,tbody);tableWrap.append(table);ordersPanel.append(orderTools,ordersMessage,tableWrap);desk.append(productsPanel,ordersPanel);
  productsToggle.addEventListener("click",async()=>{productsPanel.classList.toggle("hidden");ordersPanel.classList.add("hidden");if(!productsPanel.classList.contains("hidden"))await renderProducts()});
  ordersToggle.addEventListener("click",async()=>{ordersPanel.classList.toggle("hidden");productsPanel.classList.add("hidden");if(!ordersPanel.classList.contains("hidden"))await renderOrders()});

  async function renderProducts(){
    productsRoot.replaceChildren();productsMessage.textContent="Loading product catalog…";
    try{
      const {data}=await api("/api/admin/shop-products");productsMessage.textContent="";
      for(const [productIndex,product] of (data.products||[]).entries()){
        const card=el("article",{className:"wholesale-card"}),heading=el("div",{className:"row"}),title=el("h3",{},product.name),activeWrap=el("label",{},"Product active"),active=el("input",{type:"checkbox"});active.checked=Boolean(product.active);activeWrap.prepend(active);heading.append(title,activeWrap);card.append(heading);
        const priceGrid=el("div",{className:"wholesale-detail-grid"});const prices=[];
        if(productIndex===0){
          product.prices.forEach((cents,index)=>{const label=el("label",{},`Shared Size ${index} price (USD)`),input=el("input",{type:"number",min:"0.01",max:"1000",step:"0.01",value:(cents/100).toFixed(2)});label.append(input);priceGrid.append(label);prices.push(input)});card.append(priceGrid);
        }else card.append(el("p",{className:"muted"},"Uses the shared six-size price schedule shown on the first product."));
        for(const variant of product.variants){
          const section=el("section",{className:"wholesale-card"}),variantTop=el("div",{className:"row"}),variantTitle=el("strong",{},variant.name),variantActiveWrap=el("label",{},"Variant active"),variantActive=el("input",{type:"checkbox"});variantActive.checked=Boolean(variant.active);variantActiveWrap.prepend(variantActive);variantTop.append(variantTitle,variantActiveWrap);section.append(variantTop);
          const sizeRow=el("div",{className:"row"}),inventoryMap=new Map((variant.inventory||[]).map((entry)=>[Number(entry.size),Number(entry.availableQuantity)])),sizeInputs=[],stockInputs=[];
          for(let size=0;size<=5;size++){const label=el("label",{},`Size ${size}`),available=el("input",{type:"checkbox"});available.checked=(variant.availableSizes||[]).includes(size);label.prepend(available);sizeRow.append(label);sizeInputs.push(available);const stockLabel=el("label",{},`Size ${size} stock · blank = not tracked`),stock=el("input",{type:"number",min:"0",max:"100000",step:"1",placeholder:"Untracked"});if(inventoryMap.has(size))stock.value=String(inventoryMap.get(size));stockLabel.append(stock);sizeRow.append(stockLabel);stockInputs.push(stock)}
          section.append(sizeRow);card.append(section);
          const save=el("button",{type:"button"},"Save product settings");save.addEventListener("click",async()=>{save.disabled=true;productsMessage.textContent=`Saving ${product.name}…`;try{
            const values=productIndex===0?prices.map((input)=>Math.round(Number(input.value)*100)):undefined;if(values&&values.some((value)=>!Number.isInteger(value)||value<1))throw new Error("Enter a valid USD price for all six sizes.");
            const update={productId:product.productId,active:active.checked,variantId:variant.variantId,variantActive:variantActive.checked,availableSizes:sizeInputs.flatMap((input,index)=>input.checked?[index]:[]),inventory:stockInputs.map((input,size)=>({variantId:variant.variantId,size,quantity:input.value===""?null:Number(input.value)}))};if(values)update.prices=values;
            await api("/api/admin/shop-products",{method:"PATCH",body:JSON.stringify(update)});productsMessage.textContent=`${product.name} saved.`;await renderProducts();
          }catch(error){productsMessage.textContent=error.message;productsMessage.className="notice error";save.disabled=false}});card.append(save);
        }
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
  return{load:async()=>{if(!productsPanel.classList.contains("hidden"))await renderProducts();if(!ordersPanel.classList.contains("hidden"))await renderOrders()}};
}
