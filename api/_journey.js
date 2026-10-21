'use strict';
const {createHmac}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION=/^[a-zA-Z0-9_-]{8,100}$/;
const TYPES=new Set(['page_view','page_engagement','product_view','color_view','size_selected','version_selected','size_guide_open','add_to_cart','cart_quantity_changed','remove_from_cart','cart_open','checkout_started','checkout_step_view','checkout_field_started','checkout_field_completed','checkout_validation_error','delivery_lookup_error','checkout_submit_attempt','checkout_submit_failed','checkout_submit_acknowledged','payment_redirect','payment_redirect_failed','scroll_depth']);
const FIELDS=new Set(['name','phone','city','branch','payment']);
const cleanId=v=>typeof v==='string'&&UUID.test(v)?v.toLowerCase():null;
function item(value){
  if(!value||typeof value!=='object')return null;
  const uid=String(value.uid||'');if(!/^[\w-]{1,64}$/.test(uid))return null;
  const out={uid};
  const size=String(value.size||'');if(/^[\d.,\s-]{1,12}$/.test(size))out.size=size;
  const version=value.season_id||value.seasonId;
  if(['winter','autumn','spring','summer'].includes(version))out.season_id=version;
  if(Number.isFinite(Number(value.qty)))out.qty=Math.max(0,Math.min(100,Math.floor(Number(value.qty))));
  if(Number.isFinite(Number(value.price)))out.price=Math.max(0,Math.min(100000,Number(value.price)));
  return out;
}
function data(value){
  value=value&&typeof value==='object'?value:{};
  const out=item(value)||{};
  if(Array.isArray(value.items))out.items=value.items.slice(0,30).map(item).filter(Boolean);
  if(FIELDS.has(value.field))out.field=value.field;
  if(['form','done'].includes(value.step))out.step=value.step;
  if(['required','invalid','not_selected','network_or_provider','request_failed','server_rejected','no_payment_form'].includes(value.reason))out.reason=value.reason;
  if(['np','card','cod'].includes(value.payment_method))out.payment_method=value.payment_method;
  if(['mobile','tablet','desktop'].includes(value.device))out.device=value.device;
  try{const ref=new URL(value.referrer_origin);if(['http:','https:'].includes(ref.protocol))out.referrer_origin=ref.origin;}catch{}
  for(const key of ['total','count','active_ms','scroll_pct','http_status']){
    if(Number.isFinite(value[key]))out[key]=Math.max(0,Math.min(key==='active_ms'?60000:10000000,value[key]));
  }
  return out;
}
function touch(value){
  if(!value||typeof value!=='object')return {};
  const out={};
  for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','campaign_id','adset_id','ad_id']){
    const s=typeof value[key]==='string'?value[key].trim().slice(0,160):'';
    if(s&&!/[@<>\r\n]|bearer|token|password|phone|email/i.test(s))out[key]=s;
  }
  try{const u=new URL(value.referrer_origin);if(['http:','https:'].includes(u.protocol))out.referrer_origin=u.origin;}catch{}
  if(typeof value.path==='string'&&/^\/[a-zA-Z0-9/_-]*$/.test(value.path))out.path=value.path.slice(0,160);
  return out;
}
function context(value){
  value=value&&typeof value==='object'?value:{};
  // Anonymous journey identity is optional. Checkout must also work without consent.
  if(value.analytics_consent!==true)return null;
  const visitor=cleanId(value.visitor_id),checkout=cleanId(value.checkout_id);
  const session=typeof value.session_id==='string'&&SESSION.test(value.session_id)?value.session_id:null;
  if(!visitor||!session)return null;
  return {visitor_id:visitor,checkout_id:checkout,session_id:session,first_touch:touch(value.first_touch),last_touch:touch(value.last_touch)};
}
function event(value,ctx,now=new Date()){
  if(!value||!TYPES.has(value.event_type))return null;
  const id=cleanId(value.event_id);if(!id)return null;
  const at=Date.parse(value.occurred_at);
  if(!Number.isFinite(at)||at<now.getTime()-86400000||at>now.getTime()+300000)return null;
  const path=typeof value.page_path==='string'&&/^\/[a-zA-Z0-9/_-]*$/.test(value.page_path)?value.page_path.slice(0,160):'/';
  const payload=data(value.event_data);
  if(value.event_type==='page_view'){payload.first_touch=touch(ctx.first_touch);payload.last_touch=touch(ctx.last_touch);}
  if(ctx.first_touch?.utm_source==='qa')payload.is_test=true;
  return {event_id:id,visitor_id:ctx.visitor_id,session_id:ctx.session_id,checkout_id:cleanId(value.checkout_id)||ctx.checkout_id,event_type:value.event_type,event_data:payload,page_path:path,source:'browser',occurred_at:new Date(at).toISOString()};
}
function client(env=process.env,fetcher=globalThis.fetch,timeoutMs=5000){
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw new Error('JOURNEY_UNAVAILABLE');
  return async(path,options={})=>{
    const r=await fetcher(base+'/rest/v1/'+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(timeoutMs)});
    if(!r.ok)throw new Error('JOURNEY_SOURCE_UNAVAILABLE');
    return r.status===204||options.headers?.Prefer?.includes('return=minimal')?null:r.json();
  };
}
async function allowed(req,env,rest){
  const origins=new Set(['https://ultera.in.ua','https://www.ultera.in.ua','https://ultera-home.vercel.app']);
  for(const name of ['VERCEL_URL','VERCEL_BRANCH_URL'])if(env[name])origins.add('https://'+env[name]);
  if(!origins.has(req.headers.origin))return false;
  // Rate-limit identity is a keyed digest, never a stored raw IP address.
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,200);
  const digest=createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update('ultera-journey:'+ip).digest('hex');
  const result=await rest('rpc/check_and_increment_rate_limit',{method:'POST',body:JSON.stringify({p_ip:'j-'+digest,p_endpoint:'ultera-journey',p_limit:180})});
  return result?.allowed===true;
}
async function saveOrderJourney(order,body,stage,{env=process.env,fetcher=globalThis.fetch}={}){
  const ctx=context(body.tracking);if(!ctx||!cleanId(order?.id))return false;
  try{
    const rest=client(env,fetcher,1200);
    await rest('ulhome_order_journeys?on_conflict=order_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({order_id:order.id,...ctx})});
    const type=stage==='lead'?'checkout_draft_saved':'order_saved';
    await rest('ulhome_journey_events?on_conflict=event_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({event_id:order.id,order_id:order.id,visitor_id:ctx.visitor_id,session_id:ctx.session_id,checkout_id:ctx.checkout_id,event_type:type,event_data:{total:Number(order.total)||0,count:(body.items||[]).reduce((s,i)=>s+(Number(i.qty)||1),0)},source:'server',page_path:'/',occurred_at:new Date().toISOString()})});
    return true;
  }catch{console.warn('[journey] order linkage unavailable');return false;}
}
module.exports={UUID,cleanId,item,data,touch,context,event,client,allowed,saveOrderJourney};
