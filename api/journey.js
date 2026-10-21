'use strict';
const J=require('./_journey');
function createHandler({env=process.env,fetcher=globalThis.fetch,now=()=>new Date()}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization, Origin');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(code,body)=>res.status(code).json(body);
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(405,{ok:false});}
    try{
      const rest=J.client(env,fetcher);
      if(req.method==='POST'){
        const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
        if(Buffer.byteLength(raw)>32768)return send(413,{ok:false});
        let body;try{body=JSON.parse(raw);}catch{return send(400,{ok:false});}
        const ctx=J.context(body.context);
        if(!ctx||!Array.isArray(body.events)||body.events.length<1||body.events.length>30)return send(400,{ok:false});
        if(!await J.allowed(req,env,rest))return send(403,{ok:false});
        const rows=body.events.map(e=>J.event(e,ctx,now()));
        if(rows.some(r=>!r))return send(400,{ok:false});
        await rest('ulhome_journey_events?on_conflict=event_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(rows)});
        return send(200,{ok:true,accepted:rows.length});
      }
      const token=/^Bearer ([^\s]{1,8192})$/.exec(req.headers.authorization||'')?.[1];
      if(!token)return send(401,{error:'Увійдіть як адміністратор'});
      if(env.ULTERA_FINANCE_ENABLED!=='1')return send(503,{error:'Приватний доступ ще закрито'});
      const auth=await fetcher(env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
      if(!auth.ok)return send(401,{error:'Увійдіть знову'});
      const user=await auth.json();
      if(!user.id||!user.email||!user.email_confirmed_at||user.is_anonymous)return send(403,{error:'Немає доступу'});
      const admins=await rest('ulhome_admins?'+new URLSearchParams({select:'email',email:'eq.'+user.email,limit:'1'}));
      if(!admins.some(a=>a.email===user.email))return send(403,{error:'Немає доступу'});
      const id=J.cleanId(new URL(req.url,'https://ultera.in.ua').searchParams.get('order_id'));
      if(!id)return send(400,{error:'Оберіть замовлення'});
      const links=await rest('ulhome_order_journeys?'+new URLSearchParams({select:'order_id,visitor_id,checkout_id,session_id,first_touch,last_touch,captured_at',order_id:'eq.'+id,limit:'1'}));
      const link=links[0];if(!link)return send(200,{link:null,events:[],orders:[],truncated:false});
      const q=new URLSearchParams({select:'event_id,event_type,event_data,page_path,source,occurred_at,created_at,session_id,checkout_id,order_id',visitor_id:'eq.'+link.visitor_id,order:'occurred_at.desc,event_id.desc',limit:'501'});
      q.append('occurred_at','gte.'+new Date(now().getTime()-180*86400000).toISOString());
      const events=await rest('ulhome_journey_events?'+q);
      const related=await rest('ulhome_order_journeys?'+new URLSearchParams({select:'order_id',visitor_id:'eq.'+link.visitor_id,limit:'101'}));
      const ids=related.slice(0,100).map(r=>J.cleanId(r.order_id)).filter(Boolean);
      const rows=ids.length?await rest('ulhome_orders?'+new URLSearchParams({select:'id,number,status,keycrm_id,keycrm_status_name,keycrm_status_group,keycrm_synced_at,payment_status,total,items,created_at',id:'in.('+ids.join(',')+')',order:'created_at.asc',limit:'100'})):[];
      // Never return contacts, addresses, notes or arbitrary item properties.
      const orders=rows.map(r=>({id:r.id,number:r.number,status:r.status,keycrm_id:r.keycrm_id,keycrm_status_name:r.keycrm_status_name,keycrm_status_group:r.keycrm_status_group,keycrm_synced_at:r.keycrm_synced_at,payment_status:r.payment_status,total:r.total,created_at:r.created_at,items:(r.items||[]).slice(0,30).map(i=>({...J.item(i),title:String(i.title||'').slice(0,160),family:String(i.family||'').slice(0,80)}))}));
      return send(200,{link,events:events.slice(0,500).reverse(),orders,truncated:events.length>500||related.length>100,windowDays:180});
    }catch{return send(503,{ok:false,error:'Аналітика тимчасово недоступна. Замовлення працюють незалежно.'});}
  };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
