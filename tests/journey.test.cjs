'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {randomUUID}=require('node:crypto');
const J=require('../api/_journey');const {createHandler}=require('../api/journey');
const visitor=randomUUID(),checkout=randomUUID(),order=randomUUID(),now=new Date('2026-10-21T12:00:00Z');
const ctx={analytics_consent:true,visitor_id:visitor,checkout_id:checkout,session_id:'s-test-123456',first_touch:{utm_source:'facebook',phone:'PRIVATE-PHONE'},last_touch:{utm_campaign:'autumn'}};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-fixture',ULTERA_FINANCE_ENABLED:'1'};
const response=(value,status=200)=>new Response(status===204||status===201?null:JSON.stringify(value),{status});
const ev=()=>({event_id:randomUUID(),event_type:'checkout_validation_error',event_data:{field:'phone',reason:'invalid',phone:'PRIVATE-PHONE',name:'PRIVATE-NAME',value:'PRIVATE-VALUE',title:'PRIVATE-TITLE'},page_path:'/',occurred_at:now.toISOString()});
async function invoke(fetcher,req={},extra={}){let code,body;const headers={};const res={setHeader(k,v){headers[k]=v;},status(c){code=c;return this;},json(b){body=b;return b;}};await createHandler({env:{...env,...extra},fetcher,now:()=>now})({method:'POST',headers:{origin:'https://ultera.in.ua','x-forwarded-for':'192.0.2.1'},body:{context:ctx,events:[ev()]},url:'/api/journey',...req},res);return {code,body,headers};}
test('journey sanitization excludes free text, contacts, URLs and raw errors',()=>{
  const row=J.event({...ev(),page_path:'/?phone=PRIVATE-PHONE',event_data:{...ev().event_data,items:[{uid:'809858137952',size:'42',qty:1,title:'PRIVATE-TITLE',seasonId:'winter'}]}},J.context(ctx),now);
  const value=JSON.stringify(row);for(const marker of ['PRIVATE','phone=','title','name','value'])assert.ok(!value.includes(marker));
  assert.deepEqual(row.event_data.items,[{uid:'809858137952',size:'42',qty:1,season_id:'winter'}]);assert.equal(row.page_path,'/');assert.equal(row.source,'browser');
});
test('no consent, invalid identities, old times or forged server events are accepted',()=>{
  assert.equal(J.context({...ctx,analytics_consent:false}),null);assert.equal(J.context({...ctx,visitor_id:'bad'}),null);
  assert.equal(J.event({...ev(),event_type:'order_saved'},ctx,now),null);assert.equal(J.event({...ev(),occurred_at:'2020-01-01'},ctx,now),null);
});
test('collector rate limits by keyed digest and idempotently writes only private sanitized events',async()=>{
  const writes=[];const result=await invoke(async(url,init)=>{writes.push({url,init});if(url.includes('/rpc/'))return response({allowed:true});return response(null,201);});
  assert.equal(result.code,200);assert.equal(result.body.accepted,1);assert.equal(writes.length,2);
  assert.ok(!writes[0].init.body.includes('192.0.2.1'));assert.match(writes[0].init.body,/j-[a-f0-9]{64}/);
  assert.match(writes[1].url,/ulhome_journey_events\?on_conflict=event_id/);assert.match(writes[1].init.headers.Prefer,/ignore-duplicates/);assert.ok(!writes[1].init.body.includes('PRIVATE'));
});
test('collector refuses foreign origins, oversized batches and unavailable rate limiting',async()=>{
  assert.equal((await invoke(()=>assert.fail('foreign origin must not query'),{headers:{origin:'https://attacker.example'}})).code,403);
  assert.equal((await invoke(()=>assert.fail(),{body:{context:ctx,events:Array(31).fill(ev())}})).code,400);
  assert.equal((await invoke(async()=>response({},500))).code,503);
  assert.equal((await invoke(async()=>response({allowed:false}))).code,403);
});
test('private read rejects unauthenticated, revoked and non-admin access before order data',async()=>{
  assert.equal((await invoke(()=>assert.fail(),{method:'GET',headers:{}})).code,401);
  assert.equal((await invoke(async()=>response({},401),{method:'GET',headers:{authorization:'Bearer expired'}})).code,401);
  let calls=0;const r=await invoke(async url=>{calls++;if(url.includes('/auth/'))return response({id:'fixture',email:'owner@example.com',email_confirmed_at:'yes'});assert.match(url,/ulhome_admins/);return response([]);},{method:'GET',headers:{authorization:'Bearer fixture'}});assert.equal(r.code,403);assert.equal(calls,2);
});
test('server links exact saved order, draft and checkout; network failure does not fail checkout',async()=>{
  const writes=[];assert.equal(await J.saveOrderJourney({id:order,total:4500},{tracking:ctx,items:[{qty:1}]},'final',{env,fetcher:async(url,init)=>{writes.push({url,body:JSON.parse(init.body)});return response(null,201);}}),true);
  assert.equal(writes.length,2);assert.equal(writes[0].body.order_id,order);assert.equal(writes[1].body.event_type,'order_saved');assert.equal(writes[1].body.source,'server');assert.equal(writes[1].body.checkout_id,checkout);
  assert.equal(await J.saveOrderJourney({id:order},{tracking:null},'final',{env,fetcher:()=>assert.fail()}),false);
  assert.equal(await J.saveOrderJourney({id:order},{tracking:ctx},'final',{env,fetcher:async()=>{throw Error('offline');}}),false);
});
test('authorized journey contains original site models but no customer fields or secret values',async()=>{
  const r=await invoke(async(url)=>{
    if(url.includes('/auth/'))return response({id:'fixture',email:'owner@example.com',email_confirmed_at:'yes'});
    if(url.includes('/ulhome_admins'))return response([{email:'owner@example.com'}]);
    if(url.includes('/ulhome_order_journeys'))return response(url.includes('select=order_id&')?[{order_id:order}]:[{order_id:order,visitor_id:visitor,session_id:ctx.session_id,first_touch:{},last_touch:{}}]);
    if(url.includes('/ulhome_journey_events'))return response([]);
    if(url.includes('/ulhome_orders'))return response([{id:order,number:123,customer_name:'PRIVATE-NAME',customer_phone:'PRIVATE-PHONE',notes:'PRIVATE-NOTES',items:[{uid:'809858137952',title:'Hunk3 All Black',size:'42',secret:'PRIVATE-SECRET'}]}]);
    assert.fail(url);
  },{method:'GET',url:'/api/journey?order_id='+order,headers:{authorization:'Bearer fixture'}});
  assert.equal(r.code,200);assert.equal(r.body.orders[0].items[0].title,'Hunk3 All Black');assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));assert.match(r.headers['Cache-Control'],/no-store/);
});
function browser(shared={},options={}){
  const values=shared.local||new Map(),sessions=shared.session||new Map(),requests=[],events={};
  const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)});
  const doc={visibilityState:'visible',readyState:'loading',referrer:'https://www.facebook.com/anything?private=hidden',addEventListener:(k,fn)=>events[k]=fn,documentElement:{scrollHeight:1000}};
  const win={crypto:{randomUUID},location:new URL('https://ultera.in.ua/?utm_source=facebook&utm_campaign=autumn&phone=PRIVATE-PHONE'),localStorage:storage(values),sessionStorage:storage(sessions),navigator:options.navigator||{},setTimeout,clearTimeout,setInterval(){},innerWidth:390,addEventListener:(k,fn)=>events[k]=fn,fetch:async(url,init)=>{requests.push(JSON.parse(init.body));return {ok:true,status:200};}};
  const context=vm.createContext({window:win,document:doc,URL,URLSearchParams,AbortController,Date,Set,Map,Promise,Number,String,JSON});vm.runInContext(fs.readFileSync(require.resolve('../assets/customer-tracking.js'),'utf8'),context);
  return {w:win,events,values,sessions,requests,shared:{local:values,session:sessions}};
}
test('browser does not track before consent; opt-out clears identity and queued events',async()=>{
  const b=browser();b.w.trackJourney('add_to_cart',{uid:'809858137952'});await b.w.ULTERA_JOURNEY.flush();assert.equal(b.requests.length,0);assert.equal(b.values.has('ulh_journey_visitor'),false);
  b.w.ULTERA_JOURNEY.setConsent(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(b.requests.length,1);assert.ok(!JSON.stringify(b.requests).includes('PRIVATE'));
  b.w.ULTERA_JOURNEY.setConsent(false);assert.equal(b.values.has('ulh_journey_visitor'),false);assert.equal(b.w.ulteraJourneyContext(),null);
});
test('visitor survives reload; checkout survives reload/error and resets only explicitly',async()=>{
  const a=browser();a.w.ULTERA_JOURNEY.setConsent(true);const first=a.w.ulteraJourneyContext().visitor_id,id=a.w.ULTERA_JOURNEY.checkout();
  const b=browser(a.shared);assert.equal(b.w.ulteraJourneyContext().visitor_id,first);assert.equal(b.w.ULTERA_JOURNEY.checkout(),id);
  b.w.ULTERA_JOURNEY.complete();assert.notEqual(b.w.ULTERA_JOURNEY.checkout(),id);assert.equal(b.w.ulteraJourneyContext().visitor_id,first);
});
test('DNT and global privacy control override previously granted analytics consent',async()=>{
  for(const navigator of [{doNotTrack:'1'},{globalPrivacyControl:true}]){
    const b=browser({}, {navigator});b.w.ULTERA_JOURNEY.setConsent(true);b.w.trackJourney('page_view',{});await b.w.ULTERA_JOURNEY.flush();assert.equal(b.requests.length,0);assert.equal(b.w.ulteraJourneyContext(),null);
  }
});
test('storefront hooks both order stages and precise fields without changing pricing/payment endpoints',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');assert.equal((html.match(/tracking: window.ulteraJourneyContext/g)||[]).length,2);
  for(const name of ['checkout_validation_error','delivery_lookup_error','payment_redirect_failed','version_selected','size_selected','cart_open'])assert.ok(html.includes(name));
  assert.ok(!html.includes('ULTERA analytics tracker (v108'));assert.ok(html.includes("fetch('/api/wayforpay'"));
  for(const file of ['../index.html','../admin.html']){const text=fs.readFileSync(require.resolve(file),'utf8');for(const s of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=|application\/(?:ld\+json|json)/i.test(s[1]))assert.doesNotThrow(()=>new vm.Script(s[2]),file);}
});
test('consent notice stays below product modal and checkout drawer so it cannot cover buy buttons',()=>{
  const script=fs.readFileSync(require.resolve('../assets/customer-tracking.js'),'utf8');
  assert.match(script,/#ulhJourneyConsent\{[^}]*z-index:90;/);
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');assert.match(html,/\.cart-drawer\{[^}]*z-index:100;/);assert.match(html,/\.modal-overlay\{[^}]*z-index:100;/);
});
