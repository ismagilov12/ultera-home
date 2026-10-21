/* ULTERA first-party journey v1. No form values, contacts or session replay. */
(function(w,d){
  'use strict';
  if(w.ULTERA_JOURNEY)return;
  const VERSION='journey-v1',TTL=180*86400000,IDLE=30*60000;
  const keys={consent:'ulh_journey_consent',visitor:'ulh_journey_visitor',checkout:'ulh_checkout_id'};
  const fallback={};
  const store=(storage,key,value)=>{try{if(value===undefined)return storage.getItem(key);if(value===null)storage.removeItem(key);else storage.setItem(key,value);}catch{if(value===undefined)return fallback[key]||null;if(value===null)delete fallback[key];else fallback[key]=value;}return value;};
  const local=(key,value)=>store(w.localStorage,key,value),session=(key,value)=>store(w.sessionStorage,key,value);
  const uuid=()=>w.crypto.randomUUID();
  const json=value=>{try{return JSON.parse(value);}catch{return null;}};
  const blocked=()=>w.navigator.globalPrivacyControl===true||w.navigator.doNotTrack==='1';
  let consent=local(keys.consent)==='granted'&&!blocked(),visitor=null,queue=[],sending=false,controller=null,bar;
  let lastAction=Date.now(),engagedAt=Date.now(),visible=d.visibilityState!=='hidden',maxScroll=0;
  function sessionId(){
    const now=Date.now(),last=Number(session('ulh_journey_session_at')||0);
    let id=session('ulh_session_id')||w.ULHOME_SESSION_ID;
    if(!id||!last||now-last>IDLE)id='s-'+uuid();
    session('ulh_session_id',id);session('_ut_sid',id);session('ulh_journey_session_at',String(now));w.ULHOME_SESSION_ID=id;return id;
  }
  function touch(){
    const q=new URLSearchParams(w.location.search),out={path:/^\/[\w/-]*$/.test(w.location.pathname)?w.location.pathname:'/'};
    for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','campaign_id','adset_id','ad_id']){
      const value=(q.get(key)||'').slice(0,160);if(value&&!/[@<>\r\n]|bearer|token|password|phone|email/i.test(value))out[key]=value;
    }
    try{const ref=new URL(d.referrer);if(ref.origin!==w.location.origin)out.referrer_origin=ref.origin;}catch{}
    return out;
  }
  function identity(){
    if(!consent||blocked())return null;
    if(!visitor){visitor=json(local(keys.visitor));if(!visitor||visitor.expires<Date.now())visitor={id:uuid(),expires:Date.now()+TTL,first:touch(),last:touch()};
      const current=touch();if(current.utm_source||current.utm_campaign||current.referrer_origin)visitor.last=current;
      local(keys.visitor,JSON.stringify(visitor));
    }
    return visitor;
  }
  function context(){
    const v=identity();if(!v)return null;
    return {analytics_consent:true,visitor_id:v.id,session_id:sessionId(),checkout_id:session(keys.checkout)||null,first_touch:v.first,last_touch:v.last};
  }
  function safeItem(value){
    value=value||{};const out={uid:String(value.uid||'').slice(0,64)};
    if(value.size)out.size=String(value.size).slice(0,12);
    if(value.season_id||value.seasonId)out.season_id=value.season_id||value.seasonId;
    for(const key of ['qty','price'])if(value[key]!==undefined)out[key]=Number(value[key]);return out;
  }
  function safeData(value){
    value=value||{};const out=value.uid?safeItem(value):{};
    if(Array.isArray(value.items))out.items=value.items.slice(0,30).map(safeItem);
    for(const key of ['field','step','reason','payment_method','device','total','count','active_ms','scroll_pct','http_status','referrer_origin'])if(value[key]!==undefined)out[key]=value[key];
    return out;
  }
  function track(type,data){
    const ctx=context();if(!ctx)return;
    const payload=safeData(data);if(type==='page_view')payload.referrer_origin=touch().referrer_origin||'';
    queue.push({context:ctx,event:{event_id:uuid(),event_type:type,event_data:payload,page_path:touch().path,checkout_id:ctx.checkout_id,occurred_at:new Date().toISOString()}});
    if(queue.length>120)queue.shift();if(queue.length>=20)void flush();
  }
  async function flush(){
    if(!consent||blocked()||!queue.length||sending)return;
    sending=true;controller=new AbortController();const ctx=queue[0].context;
    const batch=queue.filter(x=>x.context.visitor_id===ctx.visitor_id&&x.context.session_id===ctx.session_id).slice(0,20);
    const timeout=w.setTimeout(()=>controller?.abort(),5000);
    try{
      const r=await w.fetch('/api/journey',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:ctx,events:batch.map(x=>x.event)}),keepalive:true,signal:controller.signal});
      if(r.ok||r.status===400||r.status===413){const ids=new Set(batch.map(x=>x.event.event_id));queue=queue.filter(x=>!ids.has(x.event.event_id));}
    }catch{}finally{w.clearTimeout(timeout);sending=false;controller=null;}
  }
  function checkout(){let id=session(keys.checkout);if(!id){id=uuid();session(keys.checkout,id);}return id;}
  function complete(){session(keys.checkout,null);}
  function setConsent(value){
    consent=value===true&&!blocked();local(keys.consent,consent?'granted':'denied');
    if(!consent){queue=[];visitor=null;local(keys.visitor,null);controller?.abort();}
    if(bar)bar.hidden=true;
    if(consent){track('page_view',{device:w.innerWidth<768?'mobile':w.innerWidth<1024?'tablet':'desktop'});void flush();}
  }
  function settings(){if(bar)bar.hidden=false;}
  function engagement(){
    const now=Date.now();
    if(visible&&now-lastAction<60000){const ms=Math.min(30000,now-engagedAt);if(ms>1000)track('page_engagement',{active_ms:ms});}
    engagedAt=now;
  }
  function boot(){
    const style=d.createElement('style');style.textContent='#ulhJourneyConsent{position:fixed;left:12px;bottom:12px;z-index:90;max-width:440px;padding:16px;background:#fff;color:#171e18;box-shadow:0 4px 35px #0003;border:1px solid #cbd6c2;border-radius:14px;font:13px/1.45 system-ui}#ulhJourneyConsent[hidden]{display:none}#ulhJourneyConsent p{margin:0 0 10px}#ulhJourneyConsent button{border:1px solid #ccd6c6;border-radius:8px;padding:9px 12px;margin:3px;background:#edf4e7;color:#171e18;cursor:pointer}#ulhJourneyConsent button:first-of-type{background:#d5fa49}';d.head.appendChild(style);
    bar=d.createElement('aside');bar.id='ulhJourneyConsent';bar.setAttribute('aria-label','Налаштування аналітики');
    bar.innerHTML='<p><b>Допоможеш покращити магазин?</b><br>З твого дозволу зберігатимемо перегляди моделей і кроки оформлення та пов’язуватимемо їх із замовленням. Без запису введених контактів. ID браузера — до 180 днів. Це налаштування стосується аналітики шляху ULTERA.</p><button type="button" data-choice="yes">Дозволити</button><button type="button" data-choice="no">Без аналітики</button>';
    bar.hidden=blocked()||!!local(keys.consent);bar.addEventListener('click',e=>{const button=e.target.closest('[data-choice]');if(button)setConsent(button.dataset.choice==='yes');});d.body.appendChild(bar);
    const link=d.createElement('button');link.type='button';link.textContent='Налаштування аналітики';link.style.cssText='display:block;margin:16px auto;padding:8px 12px;border:0;background:transparent;color:inherit;font:12px system-ui;text-decoration:underline;cursor:pointer';link.onclick=settings;(d.querySelector('footer')||d.body).appendChild(link);
    const fields={wFio:'name',wPhone:'phone',wCity:'city',wWh:'branch'};
    d.addEventListener('focusin',e=>{const field=fields[e.target.id];if(field)track('checkout_field_started',{field});});
    d.addEventListener('focusout',e=>{
      const field=fields[e.target.id];if(field==='name'&&e.target.value.trim().length>=2)track('checkout_field_completed',{field});
      if(field==='phone'&&/^\d{9,13}$/.test(e.target.value.replace(/\D/g,'')))track('checkout_field_completed',{field});
    });
    d.addEventListener('change',e=>{if(e.target.name==='pm')track('checkout_field_completed',{field:'payment',payment_method:e.target.value});});
    if(consent)track('page_view',{device:w.innerWidth<768?'mobile':w.innerWidth<1024?'tablet':'desktop'});
  }
  for(const name of ['pointerdown','keydown','touchstart','wheel'])w.addEventListener(name,()=>{if(Date.now()-lastAction>60000)engagedAt=Date.now();lastAction=Date.now();},{passive:true});
  w.addEventListener('scroll',()=>{const span=d.documentElement.scrollHeight-w.innerHeight;if(span<=0)return;const pct=Math.floor(Math.min(100,w.scrollY/span*100)/25)*25;if(pct>maxScroll){maxScroll=pct;track('scroll_depth',{scroll_pct:pct});}},{passive:true});
  d.addEventListener('visibilitychange',()=>{if(d.visibilityState==='hidden'){engagement();void flush();visible=false;}else{visible=true;engagedAt=Date.now();lastAction=Date.now();}});
  w.addEventListener('pagehide',()=>{engagement();void flush();});
  w.setInterval(()=>{engagement();void flush();},10000);w.setInterval(()=>void flush(),3000);
  w.addEventListener('storage',e=>{if(e.key===keys.consent&&e.newValue!=='granted'){consent=false;queue=[];visitor=null;controller?.abort();}});
  w.ULTERA_JOURNEY={version:VERSION,track,flush,checkout,complete,context,setConsent,settings};
  w.ulteraJourneyContext=()=>{try{return context();}catch{return null;}};
  w.trackJourney=(type,data)=>{try{track(type,data);}catch{}};
  w.ulteraTrack=w.trackJourney;w.ulteraTrackFlush=flush;
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',boot);else boot();
})(window,document);
