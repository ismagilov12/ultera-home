const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../assets/summary-core.js'),S=require('../api/_summary-site.js');
const cfg={fx:44.5,standard:1500,thermal:1650,boot:1800,insole:65,overhead:150000,extra:0};
const o=(id=1,extra={})=>({id:'crm-'+id,keycrm_id:id,source_id:7,keycrm_status_id:23,created_at:'2026-10-09T12:00Z',total:4490,items:[{uid:'crm-product:55',sku:'internal',title:'Ю11 черн черн',size:'44',qty:1,price:4490,is_footwear:true,kind_hint:'unknown'}],...extra});
const meta={ordersComplete:true,earliestOrderDate:'2026-10-01',latestOrderDate:'2026-10-19'};
const sum=orders=>C.summarize(orders,[],'2026-10-09','2026-10-11',cfg,meta);
const plan=(orders,asOf='2026-10-19T09:00Z',coverage=meta)=>C.planProgress(orders,'2026-10',300,asOf,cfg,coverage);
test('model chart retains original website UID/title/quantity despite CRM model and size replacement',()=>{
  const orders=[o(),o(2,{keycrm_status_id:12,created_at:'2026-10-11T12:00Z'})];
  S.enrichVersions(orders,[
    {keycrm_id:1,items:[{uid:'809858137952',title:'Hunk3 All Black',size:'42',qty:2,season_id:'winter',phone:'PRIVATE-PHONE',notes:'PRIVATE-NOTE'},{uid:'ins',title:'Устілки',family:'Insole',qty:1}]},
    {keycrm_id:2,items:[{uid:'809858137952',title:'Hunk3 All Black',size:'43',qty:1,season_id:'autumn'}]}
  ]);
  const r=sum(orders),p=r.siteProducts[0];
  assert.equal(p.uid,'site-model:809858137952');assert.equal(p.title,'Hunk3 All Black');
  assert.deepEqual(p.daily.map(d=>[d.date,d.qty,d.redeemedQty]),[['2026-10-09',2,0],['2026-10-10',0,0],['2026-10-11',1,1]]);
  assert.equal(p.qty,3);assert.equal(p.redeemedQty,1);assert.equal(r.buckets.approved.pairs,2);assert.equal(r.originalModels.pairs,3);
  assert.equal(r.products[0].title,'Ю11 черн черн');assert.equal(orders[0].items[0].size,'44');
  for(const word of ['PRIVATE-PHONE','PRIVATE-NOTE','phone','notes'])assert.ok(!JSON.stringify(orders[0].site_items).includes(word));
});
test('manual, unrelated, new, refused and QA orders cannot become website model sales',()=>{
  const orders=[o(),o(2,{source_id:1}),o(3,{keycrm_status_id:1}),o(4,{keycrm_status_id:19}),o(5,{keycrm_status_id:99})];
  S.enrichVersions(orders,[1,3,4,5].map(keycrm_id=>({keycrm_id,items:[{uid:'uid',title:'Aganta Oreo',qty:1,season_id:'autumn'}]})));
  const r=sum(orders);assert.equal(r.siteProducts.length,1);assert.equal(r.siteProducts[0].qty,1);assert.equal(r.originalModels.withoutSnapshotOrders,1);assert.equal(r.buckets.approved.orders,2);
  assert.equal(sum([o()]).siteProducts.length,0);
});
test('site models group sizes by original UID, not similar names or the current catalog',()=>{
  const orders=[o()];S.enrichVersions(orders,[{keycrm_id:1,items:[{uid:'a',title:'Aganta Black',qty:1,size:42},{uid:'a',title:'Aganta Black',qty:1,size:43},{uid:'b',title:'Aganta Black',qty:1,size:42}]}]);
  const r=sum(orders);assert.equal(r.siteProducts.length,2);assert.deepEqual(r.siteProducts.map(p=>p.qty),[2,1]);
});
test('daily thermal share uses original known-pair weights and keeps missing-day gaps, not zero',()=>{
  const r=sum([o(1,{site_version:{pairs:3,knownPairs:2,thermalPairs:1}}),o(2,{site_version:{pairs:1,knownPairs:1,thermalPairs:0}}),o(3,{created_at:'2026-10-10T12:00Z',site_version:{pairs:2,knownPairs:0,thermalPairs:0}}),o(4,{created_at:'2026-10-11T12:00Z',site_version:{pairs:2,knownPairs:2,thermalPairs:2}})]);
  assert.equal(r.daily[0].thermalShare,1/3);assert.equal(r.daily[0].thermalPairs,1);assert.equal(r.daily[0].sitePairs,4);assert.equal(r.daily[1].thermalShare,null);assert.equal(r.daily[2].thermalShare,1);
  assert.equal(r.primaryVersions.share,3/5);assert.equal(r.primaryVersions.unknownPairs,3);
  const zero=sum([o(1,{site_version:{pairs:2,knownPairs:2,thermalPairs:0}})]);assert.equal(zero.daily[0].thermalShare,0);
});
test('October plan counts approved pairs across channels, not orders/units/new/refusals/insoles',()=>{
  const two=o(2,{source_id:1,items:[{...o().items[0],qty:2},{uid:'ins',title:'Устілки',family:'Insole',is_footwear:false,qty:3,price:249}]});
  const r=plan([o(),two,o(3,{keycrm_status_id:12}),o(4,{keycrm_status_id:1}),o(5,{keycrm_status_id:19}),o(6,{keycrm_status_id:99}),o(7,{created_at:'2026-09-30T12:00Z'})]);
  assert.equal(r.actual,4);assert.equal(r.pendingPairs,1);assert.equal(r.share,4/300);assert.equal(r.remaining,296);assert.equal(r.remainingDays,13);assert.equal(r.completedDays,18);assert.equal(r.pace,4/18);assert.equal(r.requiredPace,296/13);assert.equal(r.projection,7);
});
test('month goal coverage is independent of report date/source filters and fails closed when incomplete',()=>{
  const full=plan([o()]);assert.equal(full.actual,1);assert.equal(full.complete,true);
  for(const coverage of [{...meta,earliestOrderDate:'2026-10-02'},{...meta,latestOrderDate:'2026-10-18'},{...meta,ordersComplete:false}]){
    const r=plan([o()],undefined,coverage);assert.equal(r.complete,false);assert.equal(r.actual,null);assert.equal(r.share,null);assert.equal(r.projection,null);
  }
});
test('Kyiv-safe partial today is counted toward actual, excluded from finished-day pace',()=>{
  const r=plan([o(),o(2,{created_at:'2026-10-18T21:30Z',items:[{...o().items[0],qty:2}]})]);
  assert.equal(r.actual,3);assert.equal(r.completedPairs,1);assert.equal(r.pace,1/18);assert.equal(r.through,'2026-10-19');assert.equal(r.remainingDays,13);
});
test('zero, achieved, future and finished month plans have valid nonnegative math and 31 October days',()=>{
  assert.equal(plan([]).actual,0);assert.equal(plan([]).projection,0);assert.equal(plan([]).share,0);
  const achieved=plan([o(1,{items:[{...o().items[0],qty:330}]})]);assert.equal(achieved.share,1.1);assert.equal(achieved.remaining,0);assert.equal(achieved.requiredPace,0);
  const before=plan([],'2026-09-30T12:00Z',{});assert.equal(before.actual,0);assert.equal(before.remainingDays,31);assert.equal(before.projection,null);
  const finished=plan([o()],'2026-11-01T12:00Z',{...meta,latestOrderDate:'2026-10-31'});assert.equal(finished.completedDays,31);assert.equal(finished.remainingDays,0);assert.equal(finished.projection,1);assert.equal(finished.requiredPace,null);
  assert.equal(plan([],'2026-10-31T12:00Z',{...meta,latestOrderDate:'2026-10-31'}).remainingDays,1);
});
