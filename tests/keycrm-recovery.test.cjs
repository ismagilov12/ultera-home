const test=require('node:test');const assert=require('node:assert/strict');
const {createHandler,buildPayload,groupPending,matchingOrders}=require('../api/keycrm-recovery');
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-db-test',KEYCRM_TOKEN:'private-crm-test',KEYCRM_SOURCE_ID:'7',KEYCRM_DS_NP:'1',KEYCRM_PM_NP:'4',KEYCRM_PM_CARD:'2'};
const row={id:'11111111-1111-4111-8111-111111111111',number:10,created_at:'2026-11-27T18:00:00Z',customer_name:'Fixture Person',customer_phone:'+380500000001',delivery_city:'Fixture city',delivery_branch:'Fixture warehouse',payment_method:'np',payment_status:'cod',payment_ref:'ULT-fixture',items:[{uid:'shoe',title:'Original website model',size:'42',qty:1,price:5600,season:'Зима'}],total:5320,notes:'promo: SALE1 -5% (legacy, non-promo lines only)',status:'new',landing_url:'https://ultera.in.ua/?utm_source=facebook&utm_campaign=fixture'};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
function mock({rows=[row],crm=[],jobs=[],auth=true,admin=true,lock=true,creationStatus=201,verifyMismatch=false,createThrows=false,verifyOverride={},verifyDateShift=false}={}){
  const calls=[];let posted,repairedDate;
  const f=async(url,init)=>{
    calls.push({url,init});assert.doesNotMatch(url,/wayforpay|facebook|sale_stock|compute_order_total|\/api\/order|ulhome_redeem_promo/);
    if(url.includes('/auth/v1/user'))return response({id:'admin-id',email:'admin@fixture.invalid',email_confirmed_at:'2026-01-01'},auth?200:401);
    if(url.includes('/ulhome_admins?'))return response(admin?[{email:'admin@fixture.invalid'}]:[]);
    if(url.includes('/ulhome_orders?'))return response(init.method==='PATCH'?[{id:row.id}]:rows);
    if(url.includes('/ulhome_sync_state?')){
      if(init.method==='GET')return response(jobs);
      return response(init.headers.Prefer?.includes('ignore-duplicates')?(lock?[{key:'claimed'}]:[]):[],init.headers.Prefer?.includes('minimal')?204:201);
    }
    if(url.includes('/v1/order?'))return response({data:crm,total:crm.length,last_page:1,current_page:1});
    if(url.endsWith('/v1/order')&&init.method==='POST'){
      posted=JSON.parse(init.body);if(createThrows)throw new Error('Uncertain timeout');return response({id:12345},creationStatus);
    }
    if(url.endsWith('/v1/order/12345')&&init.method==='PUT'){const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['ordered_at']);repairedDate=body.ordered_at;return response({id:12345});}
    if(url.includes('/v1/order/12345?'))return response({id:12345,source_uuid:String(row.number),source_id:7,ordered_at:repairedDate||(verifyDateShift?'2026-11-27T16:00:00Z':'2026-11-27 18:00:00'),buyer:{phone:row.customer_phone},grand_total:verifyMismatch?999:Number(row.total),products:posted?.products||buildPayload(row,[10],env).products,shipping:{shipping_address_city:row.delivery_city,shipping_receive_point:row.delivery_city+', '+row.delivery_branch},...verifyOverride});
    throw new Error('Unexpected fixture URL '+url);
  };
  return {f,calls,get posted(){return posted;}};
}
async function invoke(m,request={}){
  let code,body;const headers={};const res={setHeader(k,v){headers[k]=v;},status(c){code=c;return this;},json(b){body=b;return this;}};
  await createHandler({fetcher:m.f,env,now:()=>new Date('2026-11-28T09:00:00Z'),sleep:async()=>{}})({method:'GET',url:'/api/keycrm-recovery?from=2026-11-27&to=2026-11-28',headers:{authorization:'Bearer fixture-admin-session'},...request},res);
  return {code,body,headers};
}
const restoreBody=()=>({action:'restore',number:10,snapshot:groupPending([row])[0].snapshot});
test('uses original prices, promo, date, source number, model and destination',()=>{
  const p=buildPayload(row,[9,10],env);assert.equal(p.products[0].price,5320);assert.equal(p.products[0].name,'Original website model / р.42 / Зима');assert.equal(p.source_uuid,'10');assert.equal(p.ordered_at,'2026-11-27T18:00:00Z');assert.equal(p.marketing.utm_campaign,'fixture');assert.equal(p.payments[0].status,'not_paid');assert.equal(p.shipping.shipping_receive_point,'Fixture city, Fixture warehouse');
});
test('campaign offer keeps source SKU and never applies legacy discount twice',()=>{const p=buildPayload({...row,total:4890,items:[{uid:'bfoffer-hunk-thermo-black',title:'Hunk Thermo Black',price:4890,size:'43',qty:1}]},[10],env);assert.equal(p.products[0].sku,'550020260917');assert.equal(p.products[0].price,4890);});
test('changed or unverifiable totals fail closed',()=>assert.throws(()=>buildPayload({...row,total:4900},[10],env),/сумою/));
test('drafts and QA excluded, latest basket selected, removed insoles do not create a second order',()=>{
  const rows=[{...row,number:9,created_at:'2026-11-27T17:59Z',items:[...row.items,{uid:'insole',family:'Insole',title:'Устілки',price:249,qty:1}]},row,{...row,number:11,status:'lead'},{...row,number:12,landing_url:'https://ultera.in.ua/?utm_source=qa&utm_medium=checkout_test'}];
  const g=groupPending(rows);assert.equal(g.length,1);assert.equal(g[0].row.number,10);assert.deepEqual(g[0].attempts,[9,10]);assert.equal(g[0].changedModels,false);
});
test('different footwear models require explicit review and completed attempts stay out of list',()=>{
  const earlier={...row,number:9,created_at:'2026-11-27T17:59Z',items:[{...row.items[0],uid:'other'}]};assert.equal(groupPending([earlier,row])[0].changedModels,true);
  assert.equal(groupPending([earlier,row],[{value:{state:'done',attempts:[9,10]}}]).length,0);
});
test('existing manual order with renamed model blocks duplicate by phone',()=>{const g=groupPending([row])[0];assert.equal(matchingOrders(g,[{id:77,buyer:{phone:'0500000001'},created_at:'2026-11-27 18:30:00',products:[{name:'CRM renamed'}]}]).length,1);});
test('duplicate detection accepts explicit timezone offsets',()=>{assert.equal(matchingOrders(groupPending([row])[0],[{id:77,buyer:{phone:row.customer_phone},ordered_at:'2026-11-27T20:30:00+02:00',products:[{name:'CRM renamed'}]}]).length,1);});
test('unauthenticated request cannot read orders',async()=>{const m=mock();const r=await invoke(m,{headers:{}});assert.equal(r.code,401);assert.equal(m.calls.length,0);});
test('expired and nonadmin sessions cannot read protected records',async()=>{for(const options of [{auth:false},{admin:false}]){const m=mock(options);const r=await invoke(m);assert.ok([401,403].includes(r.code));assert.equal(m.calls.some(c=>c.url.includes('/ulhome_orders')),false);}});
test('GET dry run does not write and response contains no full contact or secrets',async()=>{const m=mock();const r=await invoke(m);assert.equal(r.code,200);assert.equal(r.body.groups.length,1);assert.ok(m.calls.every(c=>c.init.method==='GET'));for(const s of ['Fixture Person','380500000001','private-db-test','private-crm-test','fixture-admin-session'])assert.ok(!JSON.stringify(r.body).includes(s));});
test('stale snapshot and unsupported dates do not write',async()=>{const m=mock();assert.equal((await invoke(m,{method:'POST',body:{...restoreBody(),snapshot:'stale'}})).code,409);assert.ok(m.calls.every(c=>c.init.method==='GET'));assert.equal((await invoke(mock(),{url:'/api/keycrm-recovery?from=2026-11-01&to=2026-11-28'})).code,400);});
test('existing customer order blocks new creation',async()=>{const m=mock({crm:[{id:77,created_at:'2026-11-27 18:30:00',buyer:{phone:row.customer_phone},products:[{name:'model'}]}]});assert.equal((await invoke(m,{method:'POST',body:restoreBody()})).code,409);assert.ok(!m.calls.some(c=>c.init.method==='POST'));});
test('concurrent or uncertain previous attempt cannot create twice',async()=>{const m=mock({lock:false});assert.equal((await invoke(m,{method:'POST',body:restoreBody()})).code,409);assert.ok(!m.calls.some(c=>c.url.endsWith('/v1/order')&&c.init.method==='POST'));});
test('restore creates exactly once, verifies result, links only canonical site row',async()=>{const m=mock();const r=await invoke(m,{method:'POST',body:restoreBody()});assert.equal(r.code,200);assert.equal(r.body.verified,true);assert.equal(m.calls.filter(c=>c.url.endsWith('/v1/order')&&c.init.method==='POST').length,1);const updates=m.calls.filter(c=>c.url.includes('/ulhome_orders?')&&c.init.method==='PATCH');assert.equal(updates.length,1);assert.equal(JSON.parse(updates[0].init.body).keycrm_id,12345);assert.ok(m.calls.some(c=>c.init.body?.includes('"state":"done"')));});
test('network uncertainty is recorded and never marked as delivered',async()=>{const m=mock({createThrows:true});assert.equal((await invoke(m,{method:'POST',body:restoreBody()})).code,502);assert.ok(m.calls.some(c=>c.init.body?.includes('"state":"uncertain"')));assert.ok(!m.calls.some(c=>c.url.includes('/ulhome_orders?')&&c.init.method==='PATCH'));});
test('verification mismatch leaves canonical website order unlinked',async()=>{const m=mock({verifyMismatch:true});assert.equal((await invoke(m,{method:'POST',body:restoreBody()})).code,502);assert.ok(!m.calls.some(c=>c.url.includes('/ulhome_orders?')&&c.init.method==='PATCH'));});
test('verification uses actual selling price returned by KeyCRM',async()=>{const products=buildPayload(row,[10],env).products.map(p=>({...p,price:5600,price_sold:p.price}));const m=mock({verifyOverride:{products}});assert.equal((await invoke(m,{method:'POST',body:restoreBody()})).code,200);});
test('wrong model, size, destination or original date fails verification without a second create',async()=>{for(const verifyOverride of [{products:[{sku:'wrong',name:'wrong',price:5320,quantity:1}]},{shipping:{shipping_address_city:'Other city'}},{ordered_at:'2026-11-28 18:00:00'}]){const m=mock({verifyOverride});assert.equal((await invoke(m,{method:'POST',body:restoreBody()})).code,502);assert.equal(m.calls.filter(c=>c.url.endsWith('/v1/order')&&c.init.method==='POST').length,1);assert.ok(!m.calls.some(c=>c.url.includes('/ulhome_orders?')&&c.init.method==='PATCH'));}});
test('existing exact source number is verified and linked, never re-created',async()=>{const m=mock({crm:[{id:12345,source_id:7,source_uuid:'10',buyer:{phone:row.customer_phone},created_at:'2026-11-27 18:00:00',products:[{quantity:1}]}]});assert.equal((await invoke(m,{method:'POST',body:restoreBody()})).code,200);assert.ok(!m.calls.some(c=>c.url.endsWith('/v1/order')&&c.init.method==='POST'));});
test('only an owned recovery record with all other checks passed can repair its date',async()=>{
  const crm=[{id:12345,source_id:7,source_uuid:'10',buyer:{phone:row.customer_phone},created_at:'2026-11-27 18:00:00',products:[{quantity:1}]}];
  for(const owned of [false,true]){
    const jobs=owned?[{key:'keycrm_restore:'+row.id,value:{state:'created',number:10,keycrm_id:12345,attempts:[10],checks:{id:true,number:true,source:true,buyer:true,date:false,total:true,products:true,destination:true}}}]:[];
    const m=mock({crm,jobs,verifyDateShift:true});const result=await invoke(m,{method:'POST',body:restoreBody()});assert.equal(result.code,owned?200:502);assert.equal(m.calls.filter(c=>c.init.method==='PUT').length,owned?1:0);assert.ok(!m.calls.some(c=>c.url.endsWith('/v1/order')&&c.init.method==='POST'));
  }
});
