import { bearer, json, now } from "../../_lib/orders.js";

const categorySlug=(value)=>String(value||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60).replace(/-+$/g,"");
const validName=(value)=>typeof value==="string"&&value.trim().length>0&&value.trim().length<=60;

export async function onRequestGet({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop catalog storage is unavailable."},503);
  try{
    const result=await env.DB.prepare(`SELECT category.category_id AS categoryId,category.name,category.slug,category.sort_order AS sortOrder,category.active,
      (SELECT COUNT(*) FROM shop_products WHERE category_id=category.category_id) AS productCount
      FROM shop_product_categories AS category ORDER BY category.sort_order,category.name`).all();
    return json({categories:(result.results||[]).map((row)=>({...row,active:Boolean(row.active),productCount:Number(row.productCount)||0}))});
  }catch(error){console.error("Admin Shop category load failed",error instanceof Error?error.message:"unknown");return json({error:"Shop categories are not initialized. Apply migration 0022."},503)}
}

export async function onRequestPost({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop catalog storage is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({error:"Enter a category name."},400)}
  if(!validName(body.name))return json({error:"Category names must contain 1–60 characters."},400);
  const name=body.name.trim(),slug=categorySlug(name);if(!slug)return json({error:"Enter a category name with letters or numbers."},400);
  const max=await env.DB.prepare("SELECT COALESCE(MAX(sort_order),-1) AS maxOrder FROM shop_product_categories").first(),maxOrder=Number.isInteger(Number(max?.maxOrder))?Number(max.maxOrder):-1,sortOrder=maxOrder+1;
  try{
    const categoryId=`cat-${crypto.randomUUID()}`,time=now();
    await env.DB.prepare("INSERT INTO shop_product_categories(category_id,name,slug,sort_order,active,created_at,updated_at) VALUES(?,?,?, ?,1,?,?)").bind(categoryId,name,slug,sortOrder,time,time).run();
    return json({ok:true,category:{categoryId,name,slug,sortOrder,active:true,productCount:0}},201);
  }catch(error){return json({error:/unique/i.test(error instanceof Error?error.message:"")?"A category with that name or URL slug already exists.":"Could not create the category."},409)}
}

export async function onRequestPatch({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop catalog storage is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({error:"Invalid category update."},400)}
  try{
    const time=now();
    if(Array.isArray(body.order)){
      const current=await env.DB.prepare("SELECT category_id AS categoryId FROM shop_product_categories ORDER BY sort_order,name").all(),ids=(current.results||[]).map((row)=>row.categoryId);
      if(body.order.length!==ids.length||new Set(body.order).size!==ids.length||body.order.some((id)=>!ids.includes(id)))return json({error:"Refresh the category list before changing its order."},409);
      await env.DB.batch(body.order.map((id,index)=>env.DB.prepare("UPDATE shop_product_categories SET sort_order=?,updated_at=? WHERE category_id=?").bind(index,time,id)));
      return json({ok:true});
    }
    if(typeof body.categoryId!=="string")return json({error:"Choose a category."},400);
    const category=await env.DB.prepare("SELECT category_id AS categoryId,name FROM shop_product_categories WHERE category_id=?").bind(body.categoryId).first();
    if(!category)return json({error:"Shop category not found."},404);
    if(body.name!==undefined){
      if(!validName(body.name))return json({error:"Category names must contain 1–60 characters."},400);
      const name=body.name.trim(),slug=categorySlug(name);if(!slug)return json({error:"Enter a category name with letters or numbers."},400);
      await env.DB.prepare("UPDATE shop_product_categories SET name=?,slug=?,updated_at=? WHERE category_id=?").bind(name,slug,time,body.categoryId).run();
    }
    if(body.active!==undefined){if(typeof body.active!=="boolean")return json({error:"Category status must be enabled or disabled."},400);await env.DB.prepare("UPDATE shop_product_categories SET active=?,updated_at=? WHERE category_id=?").bind(body.active?1:0,time,body.categoryId).run()}
    return json({ok:true});
  }catch(error){console.error("Admin Shop category update failed",error instanceof Error?error.message:"unknown");return json({error:/unique/i.test(error instanceof Error?error.message:"")?"A category with that name or URL slug already exists.":"Could not update the category."},409)}
}

export async function onRequestDelete({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop catalog storage is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({error:"Choose a category to delete."},400)}
  if(typeof body.categoryId!=="string")return json({error:"Choose a category to delete."},400);
  try{
    const category=await env.DB.prepare("SELECT category_id AS categoryId,(SELECT COUNT(*) FROM shop_products WHERE category_id=shop_product_categories.category_id) AS productCount FROM shop_product_categories WHERE category_id=?").bind(body.categoryId).first();
    if(!category)return json({error:"Shop category not found."},404);
    if(Number(category.productCount)>0)return json({error:"Reassign this category’s products before deleting it."},409);
    await env.DB.prepare("DELETE FROM shop_product_categories WHERE category_id=?").bind(body.categoryId).run();return json({ok:true});
  }catch(error){console.error("Admin Shop category delete failed",error instanceof Error?error.message:"unknown");return json({error:"Could not delete the category."},503)}
}
