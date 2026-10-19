const test=require('node:test');const assert=require('node:assert/strict');
const {createHandler,kyivMidnight}=require('../api/summary.js');
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',ULTERA_FINANCE_ENABLED:'1',KEYCRM_TOKEN:'server-only-crm-test',KEYCRM_SOURCE_ID:'7'};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const user={id:'verified-user',email:'admin@example.invalid',email_confirmed_at:'2026-01-01'};
const row={id:'a',keycrm_id:123,customer_name:'Private customer',customer_phone:'+380501234567',landing_url:'https://ultera.in.ua/?utm_campaign=test-campaign#faq',notes:'Private note',items:[{qty:1,title:'Shoe',price:4490,secret:'private'}],total:4490,keycrm_status_id:23,created_at:'2026-10-09T10:00Z'};
async function invoke(fetcher,request={},moreEnv={}){let body,code;const headers={};const res={setHeader(k,v){headers[k]=v},status(s){code=s;return this},json(v){body=v;return this}};await createHandler({fetcher,env:{...env,...moreEnv},now:()=>new Date('2026-10-10T12:00:00Z'),crmSleep:async()=>{}})({method:'GET',url:'/api/summary?from=2026-10-01&to=2026-10-09',headers:{authorization:'Bearer valid-test-token'},...request},res);return {code,body,headers};}
function mock({auth=200,admin=true,ads=true,orders=[row],financialPlan=false}={}){return async(url,options)=>{
  assert.equal(options.method,'GET');
  if(url.includes('/auth/v1/user'))return response(user,auth);
  if(url.includes('/ulhome_admins?'))return response(admin?[{email:user.email}]:[]);
  if(url.includes('/ulhome_summary_config?'))return response([{assumptions:{fx:40,standard:1000,thermal:1200,boot:1400,insole:null,overhead:31000,extra:0,...(financialPlan?{monthlyPlans:{'2026-10':{marginPerPair:2000,adCostPerPair:500,operatingExpense:31000}}}:{})}}]);
  if(url.includes('openapi.keycrm.app/v1/order?')){assert.equal(options.headers.Authorization,'Bearer server-only-crm-test');assert.ok(new URL(url).searchParams.has('filter[created_between]'));return response({data:orders.map(o=>({id:o.keycrm_id,source_id:7,buyer:{full_name:o.customer_name,phone:o.customer_phone},grand_total:o.total,status_id:o.keycrm_status_id,ordered_at:o.created_at,products:o.items.map(i=>({...i,name:i.title,quantity:i.qty,price_sold:i.price,offer:{product_id:50}})),marketing:{utm_campaign:'test-campaign'},notes:o.notes})),current_page:1,last_page:1,total:orders.length});}
  if(url.includes('openapi.keycrm.app/v1/order/source?'))return response({data:[{id:7,name:'new ULT',currency_code:'UAH'}],last_page:1});
  if(url.includes('openapi.keycrm.app/v1/products?'))return response({data:[{id:50,name:'Shoe',category_id:22}],last_page:1});
  if(url.includes('/ulhome_meta_daily_spend?'))return response(ads?[{date:'2026-10-09',spend_usd:10,timezone:'Europe/Kyiv',account_id:'1095942551692734'}]:{},ads?200:404);
  throw new Error('Unexpected URL');
};}
test('missing token is rejected before any upstream request',async()=>{const r=await invoke(()=>assert.fail('No request allowed'),{headers:{}});assert.equal(r.code,401);});
test('authenticated monthly profit uses private plan parameters and monthly ad range, not report range',async()=>{
  let adBounds;
  const f=async(url,init)=>{if(url.includes('/ulhome_meta_daily_spend?'))adBounds=new URL(url).searchParams.getAll('date');return mock({financialPlan:true})(url,init);};
  const r=await invoke(f,{url:'/api/summary?from=2026-10-09&to=2026-10-09&include_plan=2026-10'});
  assert.equal(r.code,200);assert.equal(r.body.monthPlan.financials.target.net,419000);assert.deepEqual(adBounds,['gte.2026-10-01','lte.2026-10-10']);
  assert.equal(r.body.monthPlan.financials.current.net,null);assert.equal(r.body.monthPlan.financials.current.missingAdDays.length,9);
  assert.equal(r.body.assumptions.monthlyPlans,undefined);
});
test('monthly plan expands a narrow report once, includes full October and does not filter by source',async()=>{
  let orderReads=0,interval;
  const f=async(url,init)=>{
    if(url.includes('openapi.keycrm.app/v1/order?')){orderReads++;interval=new URL(url).searchParams.get('filter[created_between]');}
    return mock()(url,init);
  };
  const r=await invoke(f,{url:'/api/summary?from=2026-10-09&to=2026-10-09&include_plan=2026-10&source=7'});
  assert.equal(r.code,200);assert.equal(orderReads,1);assert.match(interval,/2026-09-30 21:00:00,2026-10-10 20:59:59/);
  assert.equal(r.body.monthPlan.complete,true);assert.equal(r.body.monthPlan.target,300);assert.equal(r.body.monthPlan.actual,1);assert.equal(r.body.monthPlan.through,'2026-10-10');
  assert.equal(r.body.metadata.earliestOrderDate,'2026-10-01');assert.equal(r.body.metadata.latestOrderDate,'2026-10-10');
});
test('original site model response contains only selected safe fields, no arbitrary site payload',async()=>{
  const f=async(url,init)=>url.includes('/ulhome_orders?')?response([{keycrm_id:123,items:[{uid:'809858137952',title:'Hunk3 All Black',size:'42',qty:1,season_id:'winter',notes:'PRIVATE-SITE-NOTE',customer_phone:'PRIVATE-SITE-PHONE'}]}]):mock()(url,init);
  const r=await invoke(f);assert.equal(r.code,200);assert.equal(r.body.orders[0].site_items[0].title,'Hunk3 All Black');assert.equal(r.body.orders[0].items[0].title,'Shoe');
  for(const word of ['PRIVATE-SITE-NOTE','PRIVATE-SITE-PHONE','customer_phone'])assert.ok(!JSON.stringify(r.body).includes(word));
});
test('financial release is locked by default even with a bearer token',async()=>{
  let code,body;const res={setHeader(){},status(value){code=value;return this;},json(value){body=value;}};
  await createHandler({env:{...env,ULTERA_FINANCE_ENABLED:undefined},fetcher:()=>assert.fail('No source access while locked')})({method:'GET',headers:{authorization:'Bearer test'}},res);
  assert.equal(code,503);assert.equal(body.code,'FINANCE_LOCKED');assert.equal(body.orders,undefined);
});
test('forged or expired JWT is rejected by Auth before data access',async()=>{const r=await invoke(mock({auth:401}));assert.equal(r.code,401);});
test('authenticated non-admin cannot access ULTERA finance',async()=>{const r=await invoke(mock({admin:false}));assert.equal(r.code,403);});
test('POST never mutates data',async()=>{const r=await invoke(()=>assert.fail('No request allowed'),{method:'POST'});assert.equal(r.code,405);});
test('verified response is private and excludes PII, tokens, notes and unapproved item fields',async()=>{
  const r=await invoke(mock());assert.equal(r.code,200);assert.equal(r.body.orders[0].customer_key,'1');assert.equal(r.body.orders[0].campaign_tag,'test-campaign');
  const json=JSON.stringify(r.body);for(const value of ['Private customer','380501234567','Private note','server-only-test-key','server-only-crm-test','valid-test-token','"secret"'])assert.ok(!json.includes(value));
  assert.match(r.headers['Cache-Control'],/private, no-store/);assert.equal(r.body.metadata.allCRMOrders,true);assert.equal(r.body.sources[0].site,true);
});
test('missing ad store gives an explicit unavailable source and no fabricated zero',async()=>{const r=await invoke(mock({ads:false}));assert.equal(r.code,200);assert.deepEqual(r.body.adDays,[]);assert.equal(r.body.metadata.adSourceReady,false);});
test('invalid dates and future dates are rejected',async()=>{assert.equal((await invoke(mock(),{url:'/api/summary?from=2026-02-31&to=2026-10-09'})).code,400);assert.equal((await invoke(mock(),{url:'/api/summary?from=2026-10-10&to=2026-10-11'})).code,400);});
test('Kyiv midnight correctly handles both daylight saving transition days',()=>{
  assert.equal(kyivMidnight('2026-03-29'),'2026-03-28T22:00:00.000Z');
  assert.equal(kyivMidnight('2026-03-30'),'2026-03-29T21:00:00.000Z');
  assert.equal(kyivMidnight('2026-10-25'),'2026-10-24T21:00:00.000Z');
  assert.equal(kyivMidnight('2026-10-26'),'2026-10-25T22:00:00.000Z');
});
test('WayForPay reads remain behind verified admin access, even when configured',async()=>{
  const bank={WAYFORPAY_MERCHANT:'fixture',WAYFORPAY_SECRET:'server-only-bank-test'};
  for(const options of [{auth:401},{admin:false}]){
    const r=await invoke(async(url,init)=>{assert.ok(!url.includes('wayforpay'));return mock(options)(url,init);},{},bank);assert.ok([401,403].includes(r.code));
  }
});
test('authorized endpoint enriches site version and bank installment without returning receipts or credentials',async()=>{
  const bank={WAYFORPAY_MERCHANT:'fixture',WAYFORPAY_SECRET:'server-only-bank-test'};
  const f=async(url,init)=>{
    if(url.includes('/ulhome_orders?'))return response([{keycrm_id:123,items:[{uid:'S123',size:'42',qty:1,season_id:'winter'}],payment_ref:'ULT-fixture'}]);
    if(url.includes('wayforpay.com/api')){assert.equal(JSON.parse(init.body).transactionType,'TRANSACTION_LIST');return response({reasonCode:1100,transactionList:[{transactionType:'PURCHASE',transactionStatus:'Approved',orderReference:'ULT-fixture',amount:4490,currency:'UAH',paymentSystem:'payPartsMono',cardPan:'PRIVATE-CARD',email:'PRIVATE-PAYER',merchantSignature:'PRIVATE-SIGNATURE'}]});}
    if(url.includes('openapi.keycrm.app/v1/order?')){assert.match(new URL(url).searchParams.get('include'),/payments/);return response({data:[{id:123,source_id:7,buyer:{id:1},grand_total:4490,status_id:23,ordered_at:'2026-10-09T12:00Z',payments:[{status:'not_paid',amount:4490}],products:[{sku:'S123',name:'Model',quantity:1,price_sold:4490,offer:{product_id:50,properties:[{name:'Розмір',value:'42'}]}}]}],last_page:1,total:1});}
    return mock()(url,init);
  };
  const r=await invoke(f,{},bank);assert.equal(r.code,200);assert.equal(r.body.orders[0].items[0].kind_hint,'thermal');assert.equal(r.body.orders[0].payment.paidAmount,4490);assert.equal(r.body.orders[0].payment.installment,true);assert.equal(r.body.metadata.payments.wfpReady,true);
  for(const secret of ['PRIVATE-CARD','PRIVATE-PAYER','PRIVATE-SIGNATURE','server-only-bank-test','ULT-fixture'])assert.ok(!JSON.stringify(r.body).includes(secret));
});
