'use strict';
// Read-only. Credentials stay in the server environment; no provider token is returned.
const {dates,day,settings,planProgress}=require('../assets/summary-core.js');
const {loadCRM,createReader}=require('./_summary-keycrm.js');
const {loadSiteRows,enrichVersions,loadWayfp,mergePayments}=require('./_summary-site.js');
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
function createHandler({fetcher=globalThis.fetch,env=process.env,now=()=>new Date(),crmSleep}={}){
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
      const includePlan=url.searchParams.get('include_plan')==='2026-10',planFrom='2026-10-01',planTo=day(now())<'2026-10-31'?day(now()):'2026-10-31';
      let readFrom=from,readTo=to;
      if(includePlan&&planTo>=planFrom){
        const a=from<planFrom?from:planFrom,b=to>planTo?to:planTo;
        // One paced CRM read covers nearby reports plus the monthly target. Do not
        // fetch a year of orders merely to compare a historical reporting period.
        if((Date.parse(b)-Date.parse(a))/86400000<=62){readFrom=a;readTo=b;}
      }
      const next=new Date(readTo+'T12:00Z');next.setUTCDate(next.getUTCDate()+1);
      const start=kyivMidnight(readFrom),end=kyivMidnight(next.toISOString().slice(0,10));
      const fetchedAt=now().toISOString();
      const siteSourceId=Number(env.KEYCRM_SOURCE_ID)||7;
      const reader=createReader({fetcher,token:env.KEYCRM_TOKEN,sleep:crmSleep});
      const {orders,sources,quality}=await loadCRM({fetcher,token:env.KEYCRM_TOKEN,start,end,siteSourceId,fetchedAt,reader});
      let monthPlan=null;
      if(includePlan){
        const scope={ordersComplete:true,earliestOrderDate:readFrom,latestOrderDate:readTo};
        monthPlan=planProgress(orders,'2026-10',300,fetchedAt,assumptions,scope);
        if(!monthPlan.complete){
          try{
            const after=new Date(planTo+'T12:00Z');after.setUTCDate(after.getUTCDate()+1);
            const monthly=await loadCRM({fetcher,token:env.KEYCRM_TOKEN,start:kyivMidnight(planFrom),end:kyivMidnight(after.toISOString().slice(0,10)),siteSourceId,fetchedAt,reader});
            monthPlan=planProgress(monthly.orders,'2026-10',300,fetchedAt,assumptions,{ordersComplete:true,earliestOrderDate:planFrom,latestOrderDate:planTo});
          }catch{ /* A failed independent plan read never becomes zero or hides a valid report. */ }
        }
      }
      let siteRows=[],siteReady=true,wfpRows=[],wfpReady=true;
      try{siteRows=await loadSiteRows(rest,orders);}catch{siteReady=false;}
      const siteInfo=enrichVersions(orders,siteRows);
      try{wfpRows=await loadWayfp({fetcher,env,start,end:fetchedAt});}catch{wfpReady=false;}
      const paymentInfo=mergePayments(orders,siteInfo.refs,wfpRows,wfpReady&&siteReady);
      let adDays=[],adSourceReady=true;
      try{
        const q=new URLSearchParams({select:'date,account_id,spend_usd,timezone,fetched_at,source',account_id:'eq.'+ACCOUNT,order:'date.asc'});
        q.append('date','gte.'+from);q.append('date','lte.'+to);adDays=await rest('ulhome_meta_daily_spend',q);
      }catch(e){adSourceReady=false;}
      return send(200,{orders,sources,adDays,assumptions,monthPlan,metadata:{preview:false,ordersComplete:true,earliestOrderDate:readFrom,latestOrderDate:readTo,fetchedAt,lastCRMStatusSync:fetchedAt,scopeLabel:'Усі джерела KeyCRM · поточні статуси',sourceLabel:'KeyCRM; первинні моделі та версії сайту; WayForPay; Meta — імпортовані дні Windsor.ai',adSourceReady,advertisingMode:'stored_days',allCRMOrders:true,siteSourceId,quality,currencyComplete:quality.unknownCurrencyOrders===0,dateBasis:'ordered_at',version:'original-models-plan-v3',siteReady,siteVersionLines:siteInfo.matchedLines,payments:{minimumAmount:200,wfpReady:wfpReady&&siteReady,unmatchedInstallments:paymentInfo.unmatchedInstallments}}});
    }catch(error){if(error.publicCode)return send(error.publicCode==='CRM_RATE_LIMIT'?429:502,{code:error.publicCode,error:error.message});return send(502,{error:'Не вдалося перевірити доступ або прочитати джерело. Дані не замінюються нулями.'});}
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports.kyivMidnight=kyivMidnight;


