'use strict';
// Explicit, authenticated recovery of saved checkouts. Never calls /api/order,
// stock, promotion redemption, Meta, payments or messaging APIs.
const {createHash}=require('node:crypto');
const {createReader}=require('./_summary-keycrm');
const {kyivMidnight}=require('./summary');
const {offers,isCampaign}=require('../lib/black-friday-offers.cjs');
const BASE='https://openapi.keycrm.app/v1';
const round=n=>Math.round(n*100)/100;
const phone=value=>{let s=String(value||'').replace(/\D/g,'');return s.length===10&&s[0]==='0'?'38'+s:s;};
const sourceNumber=o=>String(o.source_uuid??o.external_id??'');
const utcTime=value=>{const s=String(value||'').replace(' ','T');return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)?s:s+'Z');};
const normalized=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
const error=(status,message)=>Object.assign(new Error(message),{status});
const isTest=o=>/utm_source=qa(?:[&#]|$)/i.test(o.landing_url||'')||/(?:^|[\s_-])(?:qa|test|тест)(?=$|[\s_\d-])/iu.test(o.customer_name||'');
const itemLabel=i=>[i.title,i.color_name,i.size?'р.'+i.size:'',i.season].filter(Boolean).join(' / ');
function sku(i){
  const uid=String(i.uid||'');if(offers.has(uid))return offers.get(uid).source;
  const size=String(i.size||'').match(/^(4[0-5])(?:\D|$)/)?.[1];
  return size&&['550020261003','590020261003','590020261004'].includes(uid)?uid+'-'+size:uid;
}
function buildPayload(o,aliases,env){
  if(!Array.isArray(o.items)||!o.items.length||!o.customer_name||phone(o.customer_phone).length<10)throw error(409,'Неповні дані замовлення. Потрібна ручна перевірка.');
  const promo=Number(/promo: [^\s]+ -(\d+(?:\.\d+)?)%/.exec(o.notes||'')?.[1]||0);
  const products=o.items.map(i=>{
    const quantity=Number(i.qty||1);let price=Number(i.price);
    if(!Number.isInteger(quantity)||quantity<=0||!Number.isFinite(price)||price<=0)throw error(409,'Не вдалося перевірити ціну або кількість.');
    // Item price is the original checkout snapshot. Never reprice from today's catalog.
    if(promo&&!(Number(i.promo_pct)>0||i.promoSecond)&&!isCampaign(i.uid))price=round(price*(100-promo)/100);
    return {sku:sku(i),name:itemLabel(i),price,quantity,picture:i.photo||null};
  });
  const total=round(products.reduce((s,i)=>s+i.price*i.quantity,0));
  if(Math.abs(total-Number(o.total))>0.02)throw error(409,'Ціни позицій не збігаються зі збереженою сумою. Автоматичне перенесення зупинено.');
  const marketing={};try{const u=new URL(o.landing_url);for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])if(u.searchParams.get(k))marketing[k]=u.searchParams.get(k).slice(0,500);}catch{}
  const method=Number(o.payment_method==='card'?env.KEYCRM_PM_CARD:env.KEYCRM_PM_NP)||0;
  return {
    source_id:Number(env.KEYCRM_SOURCE_ID)||1,
    external_id:String(o.number),source_uuid:String(o.number),
    ordered_at:new Date(o.created_at).toISOString().replace(/\.\d{3}Z$/,'Z'),
    buyer:{full_name:o.customer_name,phone:o.customer_phone,...(o.customer_email?{email:o.customer_email}:{})},
    shipping:{delivery_service_id:Number(env.KEYCRM_DS_NP)||1,shipping_address_city:o.delivery_city||'',shipping_receive_point:[o.delivery_city,o.delivery_branch].filter(Boolean).join(', '),recipient_full_name:o.customer_name,recipient_phone:o.customer_phone},
    manager_comment:`Відновлено після збою зв'язку з CRM. Сайт #${o.number} · ${o.payment_ref||''}. Повторні спроби: ${aliases.join(', ')}. Модель, розмір, сума та доставка — зі збереженого оформлення. Спосіб оплати: ${o.payment_method==='card'?'картка':'післяплата'}. Стан оплати перевірити окремо; відновлення не підтверджує оплату.${o.notes?'\n'+o.notes:''}`,
    marketing,products,
    payments:method?[{payment_method_id:method,amount:Number(o.total),status:'not_paid',description:'Відновлення заявки. Перед обробкою перевірити фактичну оплату.'}]:[]
  };
}
function groupPending(rows,completed=[]){
  const hidden=new Set(completed.flatMap(j=>j.value?.state==='done'?(j.value.attempts||[]):[]).map(Number));
  const map=new Map();
  for(const row of rows){if(row.keycrm_id||row.status!=='new'||isTest(row)||hidden.has(Number(row.number)))continue;
    const p=phone(row.customer_phone);if(p.length<10)continue;
    if(!map.has(p))map.set(p,[]);map.get(p).push(row);
  }
  return [...map.values()].map(attempts=>{
    attempts.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||a.number-b.number);
    const row=attempts.at(-1);
    const signature=o=>JSON.stringify((o.items||[]).filter(i=>!/insole|устіл|стельк/i.test((i.family||'')+' '+(i.title||''))).map(i=>[i.uid,String(i.size),i.qty||1,i.seasonId||i.season_id||i.season||'']).sort());
    return {row,attempts:attempts.map(a=>a.number),changedModels:new Set(attempts.map(signature)).size>1,
      alternatives:[...new Set(attempts.flatMap(a=>(a.items||[]).map(itemLabel)))],
      snapshot:createHash('sha256').update(JSON.stringify(attempts)).digest('hex')};
  });
}
function matchingOrders(group,orders){
  const p=phone(group.row.customer_phone),start=Date.parse(group.row.created_at)-72*3600000;
  return orders.filter(o=>((sourceNumber(o)===String(group.row.number))||
    (phone(o.buyer?.phone)===p&&utcTime(o.ordered_at||o.created_at)>=start&&Array.isArray(o.products)&&o.products.length>0)));
}
function createHandler({fetcher=globalThis.fetch,env=process.env,now=()=>new Date(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(s,b)=>res.status(s).json(b);
    if(!['GET','POST'].includes(req.method))return send(405,{error:'Метод не підтримується'});
    const token=/^Bearer ([^\s]{1,8192})$/.exec(req.headers.authorization||'')?.[1];
    if(!token)return send(401,{error:'Увійдіть як адміністратор ULTERA'});
    const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY;
    if(!base||!key||!env.KEYCRM_TOKEN)return send(503,{error:'Серверне підключення не налаштоване'});
    const headers={apikey:key,Authorization:'Bearer '+key};
    const rest=async(table,params={},method='GET',body,prefer)=>{
      const r=await fetcher(base+'/rest/v1/'+table+'?'+new URLSearchParams(params),{method,headers:{...headers,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw error(502,'Не вдалося прочитати або зберегти результат відновлення.');
      return r.status===204||prefer?.includes('return=minimal')?[]:r.json();
    };
    try{
      const auth=await fetcher(base+'/auth/v1/user',{method:'GET',headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
      if(!auth.ok)return send(401,{error:'Сесія недійсна. Увійдіть знову.'});
      const user=await auth.json();
      if(!user.id||!user.email||!user.email_confirmed_at||user.is_anonymous)return send(403,{error:'Потрібен підтверджений доступ адміністратора'});
      const admins=await rest('ulhome_admins',{select:'email',email:'eq.'+user.email,limit:'1'});
      if(!admins.some(a=>a.email===user.email))return send(403,{error:'Немає доступу'});
      let input={};try{input=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});}catch{return send(400,{error:'Некоректний запит'});}
      const url=new URL(req.url,'https://ultera.in.ua'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
      let start,end;
      try{start=kyivMidnight(from);const last=Date.parse(to+'T12:00:00Z');kyivMidnight(to);end=kyivMidnight(new Date(last+86400000).toISOString().slice(0,10));if(from>to||Date.parse(end)-Date.parse(start)>8*86400000||Date.parse(start)>+now())throw new Error();}catch{return send(400,{error:'Оберіть період до 7 днів'});}
      const rows=await rest('ulhome_orders',{select:'id,number,customer_name,customer_phone,customer_email,delivery_city,delivery_branch,payment_method,payment_status,payment_ref,items,total,status,notes,created_at,landing_url,keycrm_id',and:`(created_at.gte.${start},created_at.lt.${end})`,status:'eq.new',keycrm_id:'is.null',order:'created_at.asc',limit:'501'});
      if(rows.length>500)throw error(409,'Забагато записів. Скоротіть період.');
      const jobs=await rest('ulhome_sync_state',{select:'key,value',key:'like.keycrm_restore:*',limit:'1000'});
      const groups=groupPending(rows,jobs);
      const reader=createReader({fetcher,token:env.KEYCRM_TOKEN,sleep});
      const crmStart=new Date(Date.parse(start)-3*86400000).toISOString().slice(0,19).replace('T',' ');
      const crmEnd=now().toISOString().slice(0,19).replace('T',' ');
      const crm=groups.length?await reader.pages('/order',{include:'buyer,products,status','filter[created_between]':crmStart+','+crmEnd,sort:'id'},8):[];
      const view=g=>{
        let validationError=null;try{buildPayload(g.row,g.attempts,env);}catch(e){validationError=e.message;}
        return {number:g.row.number,date:g.row.created_at,total:Number(g.row.total),payment:g.row.payment_method,phoneEnding:phone(g.row.customer_phone).slice(-4),items:g.row.items.map(itemLabel),attempts:g.attempts,changedModels:g.changedModels,alternatives:g.alternatives,snapshot:g.snapshot,validationError,
          existing:matchingOrders(g,crm).map(o=>({id:o.id,external_id:sourceNumber(o),status:o.status?.name||o.status_id,total:o.grand_total,items:o.products?.map(p=>p.name)||[]}))};
      };
      if(req.method==='GET')return send(200,{ok:true,from,to,checkedAt:now().toISOString(),attempts:groups.reduce((s,g)=>s+g.attempts.length,0),groups:groups.map(view)});
      if(input.action!=='restore'||!Number.isSafeInteger(input.number)||typeof input.snapshot!=='string')return send(400,{error:'Потрібно обрати перевірену заявку'});
      const group=groups.find(g=>g.row.number===input.number);
      if(!group)return send(409,{error:'Заявка вже оброблена або не є останньою спробою. Оновіть список.'});
      if(group.snapshot!==input.snapshot)return send(409,{error:'Дані змінилися. Перевірте оновлений список.'});
      if(group.changedModels&&!input.acknowledge_variants)return send(409,{error:'Клієнт змінював модель. Спочатку підтвердіть останній склад.'});
      const matches=matchingOrders(group,crm),exact=matches.find(o=>Number(o.source_id)===Number(env.KEYCRM_SOURCE_ID||1)&&sourceNumber(o)===String(group.row.number));
      if(matches.length&&!exact)return send(409,{error:'У CRM уже є замовлення цього клієнта. Автоматичне створення зупинено.',existing:view(group).existing});
      const payload=buildPayload(group.row,group.attempts,env);
      const jobKey='keycrm_restore:'+group.row.id;
      const writeJob=value=>rest('ulhome_sync_state',{key:'eq.'+jobKey},'PATCH',{value,updated_at:now().toISOString()},'return=minimal');
      let created=exact;
      if(!created){
        const claimed=await rest('ulhome_sync_state',{on_conflict:'key'},'POST',{key:jobKey,value:{state:'started',number:group.row.number,attempts:group.attempts},updated_at:now().toISOString()},'resolution=ignore-duplicates,return=representation');
        if(!claimed.length)return send(409,{error:'Попередня спроба відновлення вже зареєстрована. Перевірте CRM перед повторним створенням.'});
        try{
          await sleep(3200);
          const r=await fetcher(BASE+'/order',{method:'POST',headers:{Authorization:'Bearer '+env.KEYCRM_TOKEN,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
          const data=await r.json();
          if(!r.ok||!Number.isSafeInteger(data.id))throw error(502,'CRM не підтвердила створення. Повтор автоматично заблоковано.');
          created=data;
          await writeJob({state:'created',number:group.row.number,attempts:group.attempts,keycrm_id:data.id});
        }catch(e){await writeJob({state:'uncertain',number:group.row.number,attempts:group.attempts,...(created?.id?{keycrm_id:created.id}:{})}).catch(()=>{});throw error(502,'Результат створення потребує перевірки у CRM. Повторно заявку не надсилаємо.');}
      }
      await sleep(3200);
      const verify=await fetcher(BASE+'/order/'+created.id+'?include=buyer,products,status,shipping',{method:'GET',headers:{Authorization:'Bearer '+env.KEYCRM_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      if(!verify.ok)throw error(502,'Замовлення створене, але перевірка CRM недоступна. Не повторюйте створення.');
      let confirmed=await verify.json();
      // Correct only the record created by this recovery, never an unrelated CRM order.
      // An explicit UTC offset prevents the CRM account timezone from shifting the source date.
      const ownJob=jobs.find(j=>j.key===jobKey)?.value;
      if(ownJob?.state==='created'&&ownJob.keycrm_id===confirmed.id&&ownJob.number===group.row.number&&sourceNumber(confirmed)===String(group.row.number)&&phone(confirmed.buyer?.phone)===phone(group.row.customer_phone)&&ownJob.checks&&Object.entries(ownJob.checks).every(([k,ok])=>k==='date'||ok)&&utcTime(confirmed.ordered_at)!==utcTime(payload.ordered_at)){
        await sleep(3200);
        const repair=await fetcher(BASE+'/order/'+confirmed.id,{method:'PUT',headers:{Authorization:'Bearer '+env.KEYCRM_TOKEN,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({ordered_at:payload.ordered_at}),signal:AbortSignal.timeout(20000)});
        if(!repair.ok)throw error(502,'CRM не підтвердила виправлення часу. Запис уже існує, повторного створення немає.');
        await sleep(3200);
        const recheck=await fetcher(BASE+'/order/'+confirmed.id+'?include=buyer,products,status,shipping',{method:'GET',headers:{Authorization:'Bearer '+env.KEYCRM_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
        if(!recheck.ok)throw error(502,'Потрібно перевірити час створеної заявки в CRM.');
        confirmed=await recheck.json();
      }
      const lines=a=>a.map(i=>JSON.stringify([String(i.sku||''),normalized(i.name),Number(i.quantity),round(Number(i.price_sold??i.price))])).sort().join('\n');
      const destination=['shipping_address_city','shipping_receive_point'].every(k=>normalized(confirmed.shipping?.[k])===normalized(payload.shipping[k]));
      const checks={id:confirmed.id===created.id,number:sourceNumber(confirmed)===String(group.row.number),source:Number(confirmed.source_id)===payload.source_id,buyer:phone(confirmed.buyer?.phone)===phone(group.row.customer_phone),date:utcTime(confirmed.ordered_at)===utcTime(payload.ordered_at),total:Number.isFinite(Number(confirmed.grand_total))&&Math.abs(Number(confirmed.grand_total)-Number(group.row.total))<=0.02,products:Array.isArray(confirmed.products)&&lines(confirmed.products)===lines(payload.products),destination};
      if(Object.values(checks).some(ok=>!ok)){
        const dates={expected:payload.ordered_at,actual:confirmed.ordered_at};
        await writeJob({state:'created',number:group.row.number,attempts:group.attempts,keycrm_id:confirmed.id,checks,...(!checks.date?{dates}:{})});
        throw error(502,'CRM створила запис, але перевірка не збіглася: '+Object.entries(checks).filter(([,ok])=>!ok).map(([key])=>key).join(', ')+(!checks.date?' ('+dates.expected+' → '+dates.actual+')':'')+'. Повтор заблоковано.');
      }
      const linked=await rest('ulhome_orders',{id:'eq.'+group.row.id,keycrm_id:'is.null',select:'id'},'PATCH',{keycrm_id:confirmed.id,keycrm_external_id:String(group.row.number),keycrm_synced_at:now().toISOString()},'return=representation');
      if(linked.length!==1)throw error(409,'CRM-запис створено, але прив’язка сайту змінилася. Потрібна звірка.');
      await rest('ulhome_sync_state',{on_conflict:'key'},'POST',{key:jobKey,value:{state:'done',number:group.row.number,attempts:group.attempts,keycrm_id:confirmed.id},updated_at:now().toISOString()},'resolution=merge-duplicates,return=minimal');
      return send(200,{ok:true,number:group.row.number,keycrm_id:confirmed.id,attempts:group.attempts,verified:true});
    }catch(e){return send(e.status||502,{error:e.publicCode?'Не вдалося повністю звірити CRM. Спробуйте пізніше.':(e.status?e.message:'Не вдалося завершити відновлення. Оновіть список перед наступною дією.')});}
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports.buildPayload=buildPayload;
module.exports.groupPending=groupPending;
module.exports.matchingOrders=matchingOrders;
