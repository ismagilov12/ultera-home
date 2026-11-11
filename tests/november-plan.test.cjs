const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../assets/summary-core.js');
const {createHandler}=require('../api/summary.js');

const cfg={fx:40,standard:1000,thermal:1200,boot:1400,insole:null,overhead:150000,extra:0};
// Synthetic numbers only; the actual financial plan stays in private storage.
const planConfig={marginPerPair:2000,adCostPerPair:500,operatingExpense:30000,expenseBreakdown:{rent:4000,payroll:3000,loans:13000,personal:10000}};
const metadata={ordersComplete:true,earliestOrderDate:'2026-11-01',latestOrderDate:'2026-11-11',currencyComplete:true};
const orders=[
  {id:'a',keycrm_id:1,source_id:7,keycrm_status_id:23,total:9000,created_at:'2026-11-03T10:00:00Z',items:[{title:'Shoe',qty:2,price:4500,purchased_price:1000,is_footwear:true}]},
  {id:'b',keycrm_id:2,source_id:9,keycrm_status_id:12,total:4500,created_at:'2026-11-11T10:00:00Z',items:[{title:'Shoe',qty:1,price:4500,purchased_price:1000,is_footwear:true}]},
  {id:'c',keycrm_id:3,source_id:7,keycrm_status_id:1,total:4500,created_at:'2026-11-05T10:00:00Z',items:[{title:'Shoe',qty:1,price:4500,purchased_price:1000,is_footwear:true}]},
  {id:'d',keycrm_id:4,source_id:7,keycrm_status_id:6,total:4500,created_at:'2026-11-06T10:00:00Z',items:[{title:'Shoe',qty:1,price:4500,purchased_price:1000,is_footwear:true}]}
];
const asOf='2026-11-11T12:00:00Z';

test('November plan uses 30 calendar days and approved footwear pairs, including all sources',()=>{
  const plan=C.planProgress(orders,'2026-11',450,asOf,cfg,metadata);
  assert.deepEqual({from:plan.from,to:plan.to,actual:plan.actual,pending:plan.pendingPairs,completed:plan.completedPairs,days:plan.completedDays,remainingDays:plan.remainingDays,remaining:plan.remaining,projection:plan.projection},
    {from:'2026-11-01',to:'2026-11-30',actual:3,pending:1,completed:2,days:10,remainingDays:20,remaining:447,projection:6});
  assert.equal(plan.requiredPace,447/20);
  const ended=C.planProgress(orders,'2026-11',450,'2026-12-01T12:00:00Z',cfg,{...metadata,latestOrderDate:'2026-11-30'});
  assert.equal(ended.completedDays,30);assert.equal(ended.through,'2026-11-30');assert.equal(ended.projection,3);
});

test('financial plan reconciles and incomplete ad data cannot become actual profit',()=>{
  const plan=C.planProgress(orders,'2026-11',450,asOf,cfg,metadata);
  const f=C.profitPlan(orders,[],plan,cfg,metadata,planConfig);
  assert.equal(f.target.margin,900000);assert.equal(f.target.advertising,225000);
  assert.equal(f.target.afterAds,675000);assert.equal(f.target.net,645000);
  assert.deepEqual(f.assumptions.expenseBreakdown,planConfig.expenseBreakdown);
  assert.equal(f.current.net,null);assert.equal(f.current.missingAdDays.length,11);
  assert.equal(f.forecast.net,null);assert.equal(f.forecast.missingAdDays.length,10);
  assert.equal(f.paceScenario,-21000);
  assert.throws(()=>C.profitPlan(orders,[],plan,cfg,metadata,{...planConfig,expenseBreakdown:{...planConfig.expenseBreakdown,rent:1}}));
  const ads=C.dates('2026-11-01','2026-11-11').map(date=>({date,account_id:'1095942551692734',timezone:'Europe/Kyiv',spend_usd:10}));
  const complete=C.profitPlan(orders,ads,plan,cfg,metadata,planConfig);
  assert.notEqual(complete.current.net,null);assert.notEqual(complete.forecast.net,null);
  assert.equal(complete.current.expenses,11000);
});

test('November API reads full month despite narrow report and keeps private assumptions scoped',async()=>{
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-secret',ULTERA_FINANCE_ENABLED:'1',KEYCRM_TOKEN:'test-crm',KEYCRM_SOURCE_ID:'7'};
  const response=body=>({ok:true,status:200,json:async()=>body});let crmReads=0,interval,adBounds;
  const fetcher=async(url,options)=>{
    if(url.includes('/auth/v1/user'))return response({id:'user',email:'admin@example.invalid',email_confirmed_at:'2026-01-01'});
    if(url.includes('/ulhome_admins?'))return response([{email:'admin@example.invalid'}]);
    if(url.includes('/ulhome_summary_config?'))return response([{assumptions:{...cfg,monthlyPlans:{'2026-11':planConfig}}}]);
    if(url.includes('openapi.keycrm.app/v1/order?')){crmReads++;interval=new URL(url).searchParams.get('filter[created_between]');return response({data:orders.map(o=>({id:o.keycrm_id,source_id:o.source_id,buyer:{id:o.keycrm_id},grand_total:o.total,status_id:o.keycrm_status_id,ordered_at:o.created_at,products:o.items.map(i=>({name:i.title,quantity:i.qty,price_sold:i.price,purchased_price:i.purchased_price,offer:{product_id:50}}))})),current_page:1,last_page:1,total:orders.length});}
    if(url.includes('openapi.keycrm.app/v1/order/source?'))return response({data:[{id:7,name:'Site',currency_code:'UAH'},{id:9,name:'Other',currency_code:'UAH'}],last_page:1});
    if(url.includes('openapi.keycrm.app/v1/products?'))return response({data:[{id:50,name:'Shoe',category_id:22}],last_page:1});
    if(url.includes('/ulhome_meta_daily_spend?')){adBounds=new URL(url).searchParams.getAll('date');return response([]);}
    if(url.includes('/ulhome_orders?'))return response([]);
    throw new Error('Unexpected test URL');
  };
  let body,code;const headers={};const res={setHeader(k,v){headers[k]=v},status(v){code=v;return this},json(v){body=v;return this}};
  await createHandler({fetcher,env,now:()=>new Date(asOf),crmSleep:async()=>{}})({method:'GET',url:'/api/summary?from=2026-11-09&to=2026-11-10&include_plan=2026-11&source=7',headers:{authorization:'Bearer valid-token'}},res);
  assert.equal(code,200);assert.equal(crmReads,1);assert.match(interval,/2026-10-31 22:00:00,2026-11-11 21:59:59/);
  assert.deepEqual(adBounds,['gte.2026-11-01','lte.2026-11-11']);
  assert.equal(body.monthPlan.target,450);assert.equal(body.monthPlan.actual,3);assert.equal(body.monthPlan.pendingPairs,1);
  assert.equal(body.monthPlan.financials.target.net,645000);assert.equal(body.monthPlan.financials.current.net,null);
  assert.equal(body.assumptions.monthlyPlans,undefined);assert.match(headers['Cache-Control'],/private, no-store/);
});
