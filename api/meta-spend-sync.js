'use strict';
const {timingSafeEqual}=require('node:crypto');
const {syncSpend}=require('./_meta-spend.js');
function same(a,b){return typeof a==='string'&&typeof b==='string'&&b.length>=24&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function createHandler({fetcher=globalThis.fetch,env=process.env,now=()=>new Date(),sync=syncSpend}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,body)=>res.status(status).json(body);
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(405,{error:'Метод не підтримується'});}
    const token=/^Bearer ([^\s]{1,8192})$/.exec(req.headers.authorization||'')?.[1];
    if(!token)return send(401,{error:'Потрібен доступ адміністратора'});
    const cron=req.method==='GET'&&same(token,env.CRON_SECRET);
    if(req.method==='GET'&&!cron)return send(401,{error:'Потрібен ключ планувальника'});
    try {
      if(!cron){
        if(env.ULTERA_FINANCE_ENABLED!=='1')return send(503,{error:'Фінансовий доступ закрито'});
        const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY;
        if(!base||!key)return send(503,{error:'Підключення сервера не налаштоване'});
        const a=await fetcher(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
        if(!a.ok)return send(401,{error:'Увійдіть знову'});
        const u=await a.json();if(!u.id||!u.email||!u.email_confirmed_at||u.is_anonymous)return send(403,{error:'Потрібен підтверджений адміністратор'});
        const q=new URLSearchParams({select:'email',email:'eq.'+u.email,limit:'1'});
        const r=await fetcher(base+'/rest/v1/ulhome_admins?'+q,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
        if(!r.ok)return send(503,{error:'Не вдалося перевірити доступ'});
        const rows=await r.json();if(!Array.isArray(rows)||!rows.some(a=>a.email===u.email))return send(403,{error:'Немає доступу до фінансів ULTERA'});
      }
      const result=await sync({fetcher,env,now:now()});
      console.info('ULTERA Meta spend sync',{days:result.savedDates.length,asOf:result.sourceFetchedAt});
      return send(200,result);
    } catch(e) {
      // Never log a provider response, URL, request headers or credentials.
      const code=/^META_[A-Z_]+$/.test(e.code||'')?e.code:'META_SYNC_FAILED';
      console.warn('ULTERA Meta spend sync',code);
      return send(503,{code,error:code==='META_NOT_CONFIGURED'?'Автооновлення реклами ще не налаштоване':'Не вдалося оновити рекламу. Збережені витрати не замінено нулями.'});
    }
  };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
