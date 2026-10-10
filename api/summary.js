'use strict';
// Read-only. Credentials stay in the server environment; no provider token is returned.
const {dates,day,settings}=require('../assets/summary-core.js');
const ACCOUNT='1095942551692734';
function kyivMidnight(date){
  dates(date,date);
  const utc=Date.parse(date+'T00:00:00Z');let value=utc;
  for(let i=0;i<3;i++){
    const text=new Intl.DateTimeFormat('en',{timeZone:'Europe/Kyiv',timeZoneName:'shortOffset'}).formatToParts(new Date(value)).find(p=>p.type==='timeZoneName').value;
    const m=text.match(/GMT([+-])(\d+)(?::(\d+))?/);if(!m)throw new Error('Timezone unavailable');
    value=utc-(m[1]==='+'?1:-1)*(Number(m[2])*60+Number(m[3]||0))*60000;
  }
  return new Date(value).toISOString();
}
function createHandler({fetcher=globalThis.fetch,env=process.env,now=()=>new Date()}={}){
  return async function summary(req,res){
    res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Vary','Authorization');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,body)=>res.status(status).json(body);
    if(req.method!=='GET') {res.setHeader('Allow','GET');return send(405,{error:'Дозволено лише читання'});}
    const token=/^Bearer ([^\s]{1,8192})$/.exec(req.headers.authorization||'')?.[1];
    if(!token)return send(401,{error:'Увійдіть як адміністратор ULTERA'});
    // Fail closed until the owner rotates the previously exposed password and
    // revokes old sessions. This server-only flag must never come from the client.
    if(env.ULTERA_FINANCE_ENABLED!=='1')return send(503,{code:'FINANCE_LOCKED',error:'Фінансовий доступ ще закрито. Спочатку потрібно змінити старий пароль адміністратора та завершити попередні сеанси.'});
    const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY;
    if(!base||!key)return send(503,{error:'Підключення сервера не налаштоване'});
    const upstream=async(url,headers)=>fetcher(url,{method:'GET',headers,signal:AbortSignal.timeout(15000)});
    const headers={apikey:key,Authorization:'Bearer '+key};
    const rest=async(table,query)=>{
      const r=await upstream(base+'/rest/v1/'+table+'?'+query.toString(),headers);
      if(!r.ok){const e=new Error('Source unavailable');e.status=r.status;throw e;}
      const body=await r.json();if(!Array.isArray(body))throw new Error('Invalid source response');return body;
    };
    try{
      // Verify through Auth, never trust a decoded JWT or client-supplied email/role.
      const auth=await upstream(base+'/auth/v1/user',{apikey:key,Authorization:'Bearer '+token});
      if(!auth.ok)return send(401,{error:'Сесія недійсна. Увійдіть знову'});
      const user=await auth.json();
      if(!user.id||!user.email||!user.email_confirmed_at||user.is_anonymous)return send(403,{error:'Потрібен підтверджений доступ адміністратора'});
      const admins=await rest('ulhome_admins',new URLSearchParams({select:'email',email:'eq.'+user.email,limit:'1'}));
      if(!admins.some(a=>a.email===user.email))return send(403,{error:'Немає доступу до фінансів ULTERA'});
      const configRows=await rest('ulhome_summary_config',new URLSearchParams({select:'assumptions',id:'eq.true',limit:'1'}));
      let assumptions;try{assumptions=settings(configRows[0]?.assumptions);}catch{return send(503,{error:'Приватні параметри розрахунку ще не налаштовані'});}
      const url=new URL(req.url,'https://ultera.in.ua'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
      try{dates(from,from);dates(to,to);if(from>to||(Date.parse(to)-Date.parse(from))/86400000>731||to>day(now()))throw new Error();}
      catch{return send(400,{error:'Оберіть коректні дати не пізніше сьогодні'});}
      const next=new Date(to+'T12:00Z');next.setUTCDate(next.getUTCDate()+1);
      const start=kyivMidnight(from),end=kyivMidnight(next.toISOString().slice(0,10));
      const fields='id,keycrm_id,created_at,updated_at,status,total,items,keycrm_status_id,keycrm_status_group,keycrm_synced_at,delivery_city,landing_url,customer_name,customer_phone';
      let rows=[],complete=false;
      for(let page=0;page<20;page++){
        const q=new URLSearchParams({select:fields,order:'created_at.asc,id.asc',limit:'1000',offset:String(page*1000),status:'neq.lead',total:'gt.0'});
        q.append('created_at','gte.'+start);q.append('created_at','lt.'+end);
        const part=await rest('ulhome_orders',q);rows.push(...part);if(part.length<1000){complete=true;break;}
      }
      // Pseudonyms are only request-local ordinals, not reversible phone hashes.
      const customers=new Map();let nextCustomer=1;
      const allowedItemFields=['uid','sku','title','name','family','size','qty','quantity','price','season','seasonId','unit_cost','purchased_price','cost'];
      const orders=rows.filter(o=>!/(?:^|[\s_-])(?:qa|test|тест)(?=$|[\s_\d-])/iu.test(String(o.customer_name||''))).map(o=>{
        const digits=String(o.customer_phone||'').replace(/\D/g,'');
        const identity=digits.length>=9?digits.slice(-9):'order:'+o.id;
        if(!customers.has(identity))customers.set(identity,nextCustomer++);
        const {customer_name,customer_phone,notes,landing_url,...safe}=o;
        let campaign=null;try{campaign=new URL(landing_url,'https://ultera.in.ua').searchParams.get('utm_campaign');}catch{}
        return {...safe,customer_key:String(customers.get(identity)),campaign_tag:campaign,items:(Array.isArray(o.items)?o.items:[]).map(i=>Object.fromEntries(allowedItemFields.filter(k=>k in i).map(k=>[k,i[k]])))};
      });
      let adDays=[],adSourceReady=true;
      try{
        const q=new URLSearchParams({select:'date,account_id,spend_usd,timezone,fetched_at,source',account_id:'eq.'+ACCOUNT,order:'date.asc'});
        q.append('date','gte.'+from);q.append('date','lte.'+to);adDays=await rest('ulhome_meta_daily_spend',q);
      }catch(e){adSourceReady=false;}
      return send(200,{orders,adDays,assumptions,metadata:{preview:false,ordersComplete:complete,earliestOrderDate:from,latestOrderDate:to,fetchedAt:now().toISOString(),lastCRMStatusSync:orders.map(o=>o.keycrm_synced_at).filter(Boolean).sort().at(-1)||null,scopeLabel:'Замовлення сайту · останні синхронізовані статуси KeyCRM',sourceLabel:'Сайт ULTERA; Meta — захищені імпортовані дні Windsor.ai',adSourceReady,advertisingMode:'stored_days',allCRMOrders:false}});
    }catch{return send(502,{error:'Не вдалося перевірити доступ або прочитати джерело. Дані не замінюються нулями.'});}
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports.kyivMidnight=kyivMidnight;
