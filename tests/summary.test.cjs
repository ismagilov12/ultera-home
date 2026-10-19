const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../assets/summary-core.js');
const fixture={fx:44.5,standard:1500,thermal:1650,boot:1800,insole:null,overhead:150000,extra:0};
const o=(overrides={})=>({id:'a',keycrm_id:1,keycrm_status_id:23,created_at:'2026-10-09T12:00:00Z',updated_at:'2026-10-10T10:00:00Z',total:4490,customer_key:'a',items:[{uid:'aganta-black',title:'Aganta Black',family:'Aganta',size:'42',qty:1,price:4490}],...overrides});
const ad=(date='2026-10-09',spend_usd=10)=>({date,spend_usd,account_id:'1095942551692734',timezone:'Europe/Kyiv'});
const sum=(os=[o()],ads=[ad()],cfg={overhead:0},meta={})=>C.summarize(os,ads,'2026-10-09','2026-10-09',{...fixture,...cfg},meta);
test('status rules include production waits, reject refusal and exclude QA',()=>{
  for(const id of [2,3,4,5,8,9,11,22,23,24,26,27,28])assert.equal(C.status(o({keycrm_status_id:id,keycrm_status_group:'pending'})),'approved');
  for(const id of [6,7,15,19])assert.equal(C.status(o({keycrm_status_id:id})),'rejected');
  assert.equal(C.status(o({keycrm_status_id:12})),'redeemed');assert.equal(C.status(o({keycrm_status_id:1})),'pending');assert.equal(C.status(o({keycrm_status_id:99})),'excluded');
});
test('no approved/redeemed double count; profit is cohort scenario',()=>{
  const s=sum([o(),o({id:'b',keycrm_id:2,keycrm_status_id:12}),o({id:'c',keycrm_id:3,keycrm_status_id:1})]);
  assert.equal(s.buckets.approved.orders,2);assert.equal(s.buckets.redeemed.orders,1);assert.equal(s.buckets.waiting.orders,1);
  assert.equal(s.profit.expected,8980-3000-445);assert.equal(s.profit.redeemed,4490-1500-445);
});
test('profit uses imported spend without hiding on an ad gap; ratios retain coverage checks',()=>{
  const gap=sum([o()],[]);assert.equal(gap.profit.expected,2990);assert.equal(gap.advertising.complete,false);assert.deepEqual(gap.advertising.missingDays,['2026-10-09']);assert.equal(gap.cpo,null);
  assert.equal(sum([o()],[{...ad(),account_id:'1516175620118107'}]).cpo,null);
  assert.equal(sum([o()],[{...ad(),timezone:'America/Los_Angeles'}]).cpo,null);
  assert.equal(sum([o()],[ad('2026-10-09',0)]).profit.expected,2990);
  assert.equal(sum([o()],[ad('2026-10-09',null)]).daily[0].adSpend,null);
});
test('actual cost overrides norm; low thermal and high boot stay separate',()=>{
  const cfg=C.settings(fixture);assert.deepEqual(C.unitCost({...o().items[0],unit_cost:1400},cfg),{value:1400,estimated:false});
  assert.equal(C.unitCost({...o().items[0],seasonId:'winter'},cfg).value,1650);
  assert.equal(C.unitCost({title:'Hunk Thermo Black',family:'Hunk Thermo'},cfg).value,1800);
  assert.equal(C.unitCost({title:'Термо устілки',family:'Insole'},cfg).value,null);
});
test('discount allocation and sizes reconcile to exact order total',()=>{
  const s=sum([o({total:4700,items:[{uid:'shoe',title:'Shoe',size:'41',qty:1,price:4000},{uid:'shoe',title:'Shoe',size:'43',qty:2,price:1000}]})]);
  assert.equal(s.products.length,1);assert.equal(s.products[0].sizes.length,2);assert.equal(s.products[0].qty,3);assert.equal(C.money(s.products[0].sizes.reduce((a,b)=>a+b.revenue,0)),4700);
});
test('latest duplicate CRM order wins, repeated customer is not repeated CAC',()=>{
  const s=sum([o({total:1000,updated_at:'2026-10-09'}),o(),o({id:'b',keycrm_id:2})]);
  assert.equal(s.excluded.duplicate,1);assert.equal(s.buckets.approved.orders,2);assert.equal(s.buckets.approved.customers,1);assert.equal(s.cpo,222.5);assert.equal(s.cac,445);
});
test('unknown insole cost blocks profit but does not inflate shoe pairs',()=>{
  const s=sum([o({total:4739,items:[...o().items,{uid:'ins',title:'Устілки',qty:1,price:249,family:'Insole'}]})]);
  assert.equal(s.buckets.approved.pairs,1);assert.equal(s.buckets.approved.units,2);assert.equal(s.buckets.approved.missingCostUnits,1);assert.equal(s.profit.expected,null);
});
test('standard footwear including other model families uses stated standard norm',()=>{
  const s=sum([o({items:[{uid:'shape',title:'Shape',family:'SHAPE',qty:1,price:4490,size:42}]})]);
  assert.equal(s.buckets.approved.pairs,1);assert.equal(s.sizes[0].size,'42');assert.equal(s.profit.expected,2545);assert.equal(s.buckets.approved.estimatedCostUnits,1);
});
test('Kyiv day and exact calendar-month allocation',()=>{
  assert.equal(C.day('2026-10-08T21:30:00Z'),'2026-10-09');
  const s=C.summarize([],[],'2026-09-30','2026-10-01',fixture,{});
  assert.equal(s.overhead,C.money(150000/30+150000/31));
  assert.equal(C.summarize([],[],'2026-10-01','2026-10-31',fixture,{}).overhead,150000);
});
test('invalid periods rejected and comparison remains equal length',()=>{
  assert.throws(()=>C.dates('2026-02-31','2026-03-01'));assert.throws(()=>C.dates('2026-10-10','2026-10-09'));
  assert.deepEqual(C.previous('2026-10-03','2026-10-09'),{from:'2026-09-26',to:'2026-10-02'});
});
test('source coverage outside snapshot cannot produce profit',()=>{
  assert.equal(sum([o()],[ad()],{overhead:0},{earliestOrderDate:'2026-10-10'}).profit.expected,null);
  assert.equal(sum([o()],[ad()],{overhead:0},{latestOrderDate:'2026-10-08'}).profit.expected,null);
});
test('leads, QA and empty orders cannot inflate approvals',()=>{
  const s=sum([o(),o({keycrm_id:2,status:'lead'}),o({keycrm_id:3,keycrm_status_id:99}),o({keycrm_id:4,total:0})]);
  assert.equal(s.buckets.approved.orders,1);assert.equal(s.excluded.leads,1);assert.equal(s.excluded.tests,1);assert.equal(s.excluded.empty,1);
});
test('daily customer cost counts a repeat customer once; AOV still counts orders',()=>{
  const s=sum([o({total:3000}),o({id:'b',keycrm_id:2,total:5000}),o({id:'c',keycrm_id:3,customer_key:'c',total:4000})]);
  assert.equal(s.daily[0].approved,3);assert.equal(s.daily[0].approvedCustomers,2);
  assert.equal(s.daily[0].aov,4000);assert.equal(s.daily[0].cac,222.5);assert.equal(s.daily[0].adSpendUSD,10);
});
test('daily charts preserve missing ads and zero approvals without fabricated zero ratios',()=>{
  const noAds=sum([o()],[]).daily[0];assert.equal(noAds.adSpend,null);assert.equal(noAds.adSpendUSD,null);assert.equal(noAds.cac,null);assert.equal(noAds.aov,4490);
  const noOrders=sum([],[ad()]).daily[0];assert.equal(noOrders.adSpend,445);assert.equal(noOrders.cac,null);assert.equal(noOrders.aov,null);assert.equal(noOrders.approvedCustomers,0);
  const zero=sum([o()],[ad('2026-10-09',0)]).daily[0];assert.equal(zero.adSpend,0);assert.equal(zero.cac,0);
});
test('daily metrics stay available for covered days when another ad day is missing',()=>{
  const s=C.summarize([o()], [ad()], '2026-10-09','2026-10-10',fixture,{});
  assert.equal(s.cac,null);assert.equal(s.daily[0].cac,445);assert.equal(s.daily[1].cac,null);assert.equal(s.daily[1].adSpend,null);
});
test('daily clients deduplicate within each Kyiv day, not across the entire period',()=>{
  const s=C.summarize([o({created_at:'2026-10-08T21:30Z'}),o({id:'b',keycrm_id:2,created_at:'2026-10-09T21:30Z'})],[ad(),ad('2026-10-10')],'2026-10-09','2026-10-10',fixture,{});
  assert.deepEqual(s.daily.map(d=>d.approvedCustomers),[1,1]);assert.equal(s.buckets.approved.customers,1);
});
test('incomplete order coverage hides daily ratios but not known ad spend',()=>{
  const row=sum([o()],[ad()],{}, {ordersComplete:false}).daily[0];
  assert.equal(row.aov,null);assert.equal(row.cac,null);assert.equal(row.adSpend,445);
});
test('partial ad coverage deducts all known spend, daily overhead and extra expenses',()=>{
  const s=C.summarize([o(),o({id:'b',keycrm_id:2,keycrm_status_id:12,created_at:'2026-10-10T12:00Z'})],[ad()],'2026-10-09','2026-10-10',{...fixture,extra:500},{});
  assert.equal(s.profit.expected,C.money(8980-3000-445-C.money(150000/31*2)-500));
  assert.equal(s.profit.redeemed,C.money(4490-1500-445-C.money(150000/31*2)-500));
  assert.equal(s.cac,null);assert.equal(s.advertising.coveredDays,1);
  assert.equal(sum([o()],[ad()],{}, {sourceFiltered:true}).profit.expected,null);
  assert.equal(sum([o()],[ad()],{}, {currencyComplete:false}).profit.expected,null);
});
test('daily model series join sizes, include zero-sale dates and reconcile discounted revenue',()=>{
  const shoes=[{uid:'shoe-a',title:'Model A',size:'41',qty:1,price:4000,is_footwear:true},{uid:'shoe-a',title:'Model A',size:'43',qty:2,price:1000,is_footwear:true},{uid:'ins',title:'Устілки',family:'Insole',qty:1,price:250,is_footwear:false}];
  const s=C.summarize([
    o({total:6000,items:shoes,created_at:'2026-10-08T21:30Z'}),
    o({id:'b',keycrm_id:2,keycrm_status_id:12,total:4000,created_at:'2026-10-11T12:00Z',items:[{...shoes[0],qty:1}]}),
    o({id:'c',keycrm_id:3,keycrm_status_id:1,total:4000,items:[shoes[0]]}),
    o({id:'d',keycrm_id:4,keycrm_status_id:19,total:4000,items:[shoes[0]]})
  ],[],'2026-10-09','2026-10-11',{...fixture,insole:65,overhead:0},{});
  const p=s.products.find(p=>p.uid==='shoe-a');
  assert.equal(p.footwear,true);assert.equal(s.products.find(p=>p.uid==='ins').footwear,false);
  assert.deepEqual(p.daily.map(d=>[d.date,d.qty,d.redeemedQty]),[['2026-10-09',3,0],['2026-10-10',0,0],['2026-10-11',1,1]]);
  assert.equal(p.qty,4);assert.equal(p.redeemedQty,1);assert.equal(p.daily.reduce((v,d)=>v+d.qty,0),p.qty);
  assert.equal(C.money(p.daily.reduce((v,d)=>v+d.revenue,0)),p.revenue);
  assert.equal(C.money(s.products.reduce((v,p)=>v+p.revenue,0)),10000);
  assert.equal(p.sizes.length,2);assert.equal(s.buckets.approved.pairs,4);
});
