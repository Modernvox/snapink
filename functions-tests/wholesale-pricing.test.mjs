import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(entry) {
  const result = await build({ entryPoints:[fileURLToPath(new URL(entry, import.meta.url))], bundle:true, write:false, platform:"node", format:"esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}
const pricing = await load("../functions/_lib/wholesale.js");
const files = await load("../functions/_lib/wholesale-auth.js");

test("blank mixed-size pricing uses the total blank quantity tier and integer cents", () => {
  const result=pricing.priceWholesaleLines([{size:2,quantity:60,designType:"blank"},{size:5,quantity:40,designType:"blank"}]);
  assert.equal(result.totalQuantity,100);
  assert.equal(result.blankQuantity,100);
  assert.equal(result.customQuantity,0);
  assert.equal(result.blankSubtotalCents,32000);
  assert.deepEqual(result.lines.map(x=>[x.unitPriceCents,x.subtotalCents]),[[300,18000],[350,14000]]);
});

test("blank quantity boundaries retain the existing blank tiers and lead times", () => {
  const cases=[[49,null,""],[50,"50–99 sleeves","3–4 business days"],[99,"50–99 sleeves","3–4 business days"],[100,"100–199 sleeves","3–4 business days"],[199,"100–199 sleeves","Lead time to be confirmed"],[200,"200–499 sleeves","Lead time to be confirmed"],[201,"200–499 sleeves","Approximately 2 weeks"],[499,"200–499 sleeves","Approximately 2 weeks"],[500,"500+ sleeves","Approximately 2 weeks"]];
  for(const [quantity,tier,lead] of cases){
    const result=pricing.priceWholesaleLines([{size:0,quantity,designType:"blank"}]);
    if(quantity<50){assert.match(result.error,/at least 50 blanks/i);continue;}
    assert.equal(result.tier.blank.label,tier,`blank tier at ${quantity}`);
    assert.equal(result.leadTime.label,lead,`lead time at ${quantity}`);
  }
});

test("custom-only pricing accepts its own minimum and follows the approved $10/$8 schedule", () => {
  const cases=[[19,false,0],[20,true,20000],[49,true,49000],[50,true,40000],[99,true,79200],[100,true,80000]];
  for(const [quantity,accepted,subtotal] of cases){
    const result=pricing.priceWholesaleLines([{size:6,quantity,designType:"custom_branding"}]);
    assert.equal(!result.error,accepted,`custom acceptance at ${quantity}`);
    if(accepted){assert.equal(result.customQuantity,quantity);assert.equal(result.customSubtotalCents,subtotal);assert.equal(result.lines[0].unitPriceCents,quantity<50?1000:800);}
    else assert.match(result.error,/at least 20 custom/i);
  }
});

test("blank and custom tiers are calculated independently in a mixed order", () => {
  const result=pricing.priceWholesaleLines([
    {size:2,quantity:50,designType:"blank"},
    {size:4,quantity:50,designType:"custom_branding"},
  ]);
  assert.equal(result.totalQuantity,100);
  assert.equal(result.blankQuantity,50);
  assert.equal(result.customQuantity,50);
  assert.equal(result.tier.blank.label,"50–99 sleeves");
  assert.equal(result.tier.custom.label,"50+ custom sleeves");
  assert.equal(result.blankSubtotalCents,17500);
  assert.equal(result.customSubtotalCents,40000);
  assert.equal(result.subtotalCents,57500);
  assert.deepEqual(result.lines.map(line=>line.unitPriceCents),[350,800]);
});

test("each included order category must meet its own minimum", () => {
  assert.match(pricing.priceWholesaleLines([{size:0,quantity:49,designType:"blank"}]).error,/at least 50 blanks/i);
  assert.match(pricing.priceWholesaleLines([{size:0,quantity:19,designType:"custom_branding"}]).error,/at least 20 custom/i);
  assert.match(pricing.priceWholesaleLines([
    {size:0,quantity:50,designType:"blank"},
    {size:0,quantity:19,designType:"custom_branding"},
  ]).error,/at least 20 custom/i);
  assert.equal(pricing.priceWholesaleLines([{size:3,quantity:20,designType:"custom_branding"}]).subtotalCents,20000);
});

test("every sleeve size uses its category-specific price rule", () => {
  const blanks=pricing.priceWholesaleLines(Array.from({length:7},(_,size)=>({size,quantity:size===0?44:1,designType:"blank"})));
  assert.deepEqual(blanks.lines.map(x=>x.unitPriceCents),[350,350,350,350,400,400,400]);
  const custom=pricing.priceWholesaleLines(Array.from({length:7},(_,size)=>({size,quantity:size===0?14:1,designType:"custom_branding"})));
  assert.deepEqual(custom.lines.map(x=>x.unitPriceCents),[1000,1000,1000,1000,1000,1000,1000]);
});

test("invalid quantities, sizes, and line classifications are rejected", () => {
  for(const lines of [
    [{size:-1,quantity:50,designType:"blank"}],
    [{size:7,quantity:50,designType:"blank"}],
    [{size:0,quantity:-1,designType:"blank"}],
    [{size:0,quantity:1.2,designType:"blank"}],
    [{size:0,quantity:10001,designType:"custom_branding"}],
    [{size:0,quantity:50,designType:"unknown"}],
  ]) assert.ok(pricing.priceWholesaleLines(lines).error);
  assert.ok(pricing.priceWholesaleLines([]).error);
});

test("unsafe SVG features are rejected and basic SVG is retained", async () => {
  const make=(content)=>new File([content],"art.svg",{type:"image/svg+xml"});
  assert.equal((await files.validateWholesaleArtwork(make('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'))).error,undefined);
  for(const svg of ['<svg><script>alert(1)</script></svg>','<svg onload="alert(1)"></svg>','<svg><image href="https://example.com/a.png"/></svg>','<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///x">]><svg/>']) assert.ok((await files.validateWholesaleArtwork(make(svg))).error);
});
