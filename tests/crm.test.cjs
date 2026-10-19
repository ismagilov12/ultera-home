const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeCRM,createReader,loadCRM,utc,variant}=require('../api/_summary-keycrm.js');
const C=require('../assets/summary-core.js');
const config={fx:44.5,standard:1500,thermal:1650,boot:1800,insole:65,overhead:0,extra:0};
const line=(overrides={})=>({name:'Original name',quantity:1,price_sold:4000,purchased_price:1450,offer:{product_id:11,properties:[{name:'Розмір',value:'42'}]},...overrides});
const order=(overrides={})=>({id:1,source_id:7,buyer:{id:2,phone:'0501234567',full_name:'Private person'},ordered_at:'2026-10-08 21:30:00',created_at:'2026-10-10 10:00:00',status_id:23,grand_total:4000,products:[line()],...overrides});
const catalog=[{id:11,name:'Model black',category_id:22},{id:12,name:'Устілки',category_id:23}];
const sources=[{id:7,name:'new ULT',currency_code:'UAH'},{id:1,name:'Instagram',currency_code:'UAH'}];
const norm=rows=>normalizeCRM(rows,catalog,sources,7,'2026-10-10T12:00:00Z');
const ads=[{date:'2026-10-09',account_id:'1095942551692734',timezone:'Europe/Kyiv',spend_usd:20}];
test('UTC conversion does not depend on server locale and uses ordered date',()=>{
  assert.equal(utc('2026-10-08 21:30:00'),'2026-10-08T21:30:00.000Z');assert.equal(utc('2026-10-09T00:30:00+03:00'),'2026-10-08T21:30:00.000Z');
  assert.equal(C.day(norm([order()]).orders[0].created_at),'2026-10-09');
});
test('all CRM sources authoritative, deduplicate buyer across sources without PII',()=>{
  const result=norm([order(),order({id:2,source_id:1,buyer:{phone:'+380501234567'}})]);
  assert.equal(result.orders.length,2);assert.equal(result.orders[0].customer_key,result.orders[1].customer_key);
  assert.equal(result.orders[1].source_name,'Instagram');assert.equal(result.sources[0].site,true);
  assert.ok(!JSON.stringify(result).includes('501234567'));assert.ok(!JSON.stringify(result).includes('Private person'));
});
test('category 22 excludes insole; sold unit price and CRM cost retained exactly',()=>{
  const data=norm([order({grand_total:8249,products:[line({quantity:2}),line({quantity:1,price_sold:249,purchased_price:65,offer:{product_id:12}})]})]);
  const s=C.summarize(data.orders,ads,'2026-10-09','2026-10-09',config,{});
  assert.equal(s.buckets.approved.pairs,2);assert.equal(s.buckets.approved.orders,1);assert.equal(s.buckets.approved.customers,1);
  assert.equal(s.reconciliation.productRevenue,8000);assert.equal(s.reconciliation.productCost,2900);assert.equal(s.buckets.approved.cost,2965);
  assert.equal(s.products[0].sizes[0].size,'42');assert.equal(s.buckets.approved.revenue,8249);
});
test('CRM reconciliation includes New but excludes refusal, with approved pairs separate',()=>{
  const data=norm([order(),order({id:2,status_id:1}),order({id:3,status_id:15})]);
  const s=C.summarize(data.orders,ads,'2026-10-09','2026-10-09',config,{});
  assert.equal(s.reconciliation.pairs,2);assert.equal(s.reconciliation.approvedPairs,1);assert.equal(s.reconciliation.pendingPairs,1);assert.equal(s.buckets.rejected.orders,1);
});
test('no category is not guessed as footwear and missing sold price fails closed',()=>{
  const data=norm([order({products:[line({offer:null})]})]);assert.equal(data.quality.unknownCategoryUnits,1);assert.equal(data.orders[0].items[0].is_footwear,false);
  assert.throws(()=>norm([order({products:[line({price_sold:null})]})]),/ціни продажу/);
});
test('individual-source ratios and profit are withheld; brand spend and AOV remain visible',()=>{
  const s=C.summarize(norm([order()]).orders,ads,'2026-10-09','2026-10-09',config,{sourceFiltered:true});
  for(const key of ['cpo','cac','roas'])assert.equal(s[key],null);
  assert.equal(s.profit.expected,null);assert.equal(s.profit.redeemed,null);assert.equal(s.daily[0].cac,null);
  assert.equal(s.daily[0].adSpend,890);assert.equal(s.aov,4000);
});
test('all pages must complete and rate limiting is explicit, never partial success',async()=>{
  let calls=0;const r=createReader({token:'test',sleep:async()=>{},fetcher:async()=>({ok:true,status:200,json:async()=>({data:[{id:++calls}],total:2,last_page:2,current_page:calls})})});
  assert.equal((await r.pages('/order',{})).length,2);
  const limited=createReader({token:'test',fetcher:async()=>({ok:false,status:429})});await assert.rejects(limited.pages('/order',{}),e=>e.publicCode==='CRM_RATE_LIMIT');
  const truncated=createReader({token:'test',fetcher:async()=>({ok:true,json:async()=>({data:[{id:1}],total:2,last_page:1})})});await assert.rejects(truncated.pages('/order',{}),e=>e.publicCode==='CRM_PAGINATION_CHANGED');
});
test('pagination budget prevents silent truncation and duplicate page is rejected',async()=>{
  const r=createReader({token:'test',sleep:async()=>{},fetcher:async()=>({ok:true,json:async()=>({data:[{id:1}],last_page:2})})});
  await assert.rejects(r.pages('/order',{}),e=>e.publicCode==='CRM_PAGINATION_CHANGED');
});
test('missing KeyCRM token fails closed; cannot substitute site-only mirror',async()=>{await assert.rejects(loadCRM({token:null}),e=>e.publicCode==='CRM_NOT_CONFIGURED');});
test('test names/status excluded while legitimate new orders remain',()=>{
  const data=norm([order(),order({id:2,status_id:99}),order({id:3,buyer:{full_name:'QA TEST 123'}})]);
  assert.equal(data.orders.length,1);assert.equal(data.quality.excludedTests,2);
});
test('variant is taken from original order name, not generic catalog name',()=>{
  const data=norm([order({products:[line({name:'Aganta Thermo Black / р.42 / Зима до -15°C'})]})]);
  assert.equal(data.orders[0].items[0].title,'Model black');assert.equal(data.orders[0].items[0].kind_hint,'boot');
  assert.equal(variant('Hunk3 / Зимові термо до -7°C','',true),'thermal');
  assert.equal(variant('Ю11 черн черн','',true),'unknown');
  assert.equal(variant('Hunk3 / Осінь','',true),'standard');
});
test('unknown season is not classified as ordinary or displayed as zero thermal share',()=>{
  const s=C.summarize(norm([order()]).orders,ads,'2026-10-09','2026-10-09',config,{});
  assert.equal(s.quality.unknownVersionPairs,1);assert.equal(s.thermalShare,null);assert.equal(s.products[0].variants[0].kind,'unknown');
});
test('quality warnings apply to selected commercial approved cohort, not rejected orders or comparison dates',()=>{
  const data=norm([order({status_id:15,products:[line({offer:null})]}),order({id:2,ordered_at:'2026-10-08 10:00:00',products:[line({offer:null})]})]);
  const s=C.summarize(data.orders,ads,'2026-10-09','2026-10-09',config,{});assert.equal(s.quality.unknownCategoryUnits,0);assert.equal(s.quality.unknownVersionPairs,0);
});
