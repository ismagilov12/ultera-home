const test=require('node:test'),assert=require('node:assert/strict'),C=require('../assets/summary-core.js');
const cfg={fx:1,standard:1000,thermal:1200,boot:1400,insole:50,overhead:10000,extra:999};
const assumption={marginPerPair:2000,adCostPerPair:500,operatingExpense:31000};
const metadata={ordersComplete:true,earliestOrderDate:'2026-10-01',latestOrderDate:'2026-10-31',currencyComplete:true};
const orders=Array.from({length:18},(_,n)=>({keycrm_id:n+1,id:String(n+1),source_id:n%2?1:7,keycrm_status_id:n%3?23:12,total:4000,created_at:'2026-10-'+String(n+1).padStart(2,'0')+'T12:00Z',items:[{uid:'sku',title:'Model',qty:1,price:4000,purchased_price:1000,is_footwear:true}]}));
const ads=Array.from({length:19},(_,n)=>({date:'2026-10-'+String(n+1).padStart(2,'0'),account_id:'1095942551692734',timezone:'Europe/Kyiv',spend_usd:n===18?20:100}));
const plan=C.planProgress(orders,'2026-10',300,'2026-10-19T07:00Z',cfg,metadata);
const f=(os=orders,spend=ads,more={})=>C.profitPlan(os,spend,plan,cfg,{...metadata,...more},assumption);
test('private target formula subtracts ad cost from margin, then operating expense exactly once',()=>{
  const r=f();assert.equal(r.target.margin,600000);assert.equal(r.target.advertising,150000);assert.equal(r.target.afterAds,450000);assert.equal(r.target.net,419000);
  assert.equal(r.current.expenses,19000);assert.equal(r.current.net,54000-1820-19000);assert.equal(r.current.share,r.current.net/419000);
});
test('month projection uses actual completed-day contribution, not planned margin or incomplete today',()=>{
  const r=f();assert.equal(r.forecast.days,18);assert.equal(r.forecast.through,'2026-10-18');assert.equal(r.forecast.net,58900);
  const changed=f(orders,ads.map((ad,n)=>n===18?{...ad,spend_usd:9999}:ad));assert.equal(changed.forecast.net,r.forecast.net);assert.ok(changed.current.net<r.current.net);
});
test('plan inputs are not used as actual product margins and per-report extra is not charged to month',()=>{
  const r=f(),changed=C.profitPlan(orders,ads,plan,cfg,metadata,{...assumption,marginPerPair:9999,adCostPerPair:999});
  assert.equal(changed.current.net,r.current.net);assert.equal(changed.forecast.net,r.forecast.net);assert.notEqual(changed.target.net,r.target.net);
  assert.equal(r.current.margin,54000);assert.equal(r.current.advertising,1820);
});
test('independent business-wide month profit is unaffected by a report source-filter flag',()=>{
  assert.equal(f(orders,ads,{sourceFiltered:true}).current.net,f().current.net);
});
test('missing costs or ad days cannot fabricate a current profit or monthly projection',()=>{
  const missing=f(orders.map((o,n)=>n===0?{...o,items:[{...o.items[0],purchased_price:null,kind_hint:'unknown'}]}:o));
  assert.equal(missing.current.net,null);assert.equal(missing.current.missingCostUnits,1);assert.equal(missing.forecast.net,null);assert.equal(missing.target.net,419000);
  const gap=f(orders,ads.slice(1));assert.equal(gap.current.net,null);assert.equal(gap.forecast.net,null);assert.deepEqual(gap.current.missingAdDays,['2026-10-01']);
  assert.equal(f(orders,ads,{currencyComplete:false}).current.net,null);
});
test('unknown October coverage preserves the target and withholds actuals instead of zero',()=>{
  const bad={...plan,complete:false};const r=C.profitPlan(orders,ads,bad,cfg,metadata,assumption);assert.equal(r.target.net,419000);assert.equal(r.current,null);assert.equal(r.forecast,null);
  assert.equal(C.profitPlan(orders,ads,plan,cfg,metadata,null),null);
  assert.throws(()=>C.profitPlan(orders,ads,plan,cfg,metadata,{...assumption,marginPerPair:-1}));
});
test('a completed month forecast reconciles to its current result with full monthly expenses',()=>{
  const adMonth=C.dates('2026-10-01','2026-10-31').map(date=>({date,account_id:'1095942551692734',timezone:'Europe/Kyiv',spend_usd:10}));
  const ended=C.planProgress(orders,'2026-10',300,'2026-11-01T12:00Z',cfg,metadata);
  const r=C.profitPlan(orders,adMonth,ended,cfg,metadata,assumption);assert.equal(r.current.net,r.forecast.net);assert.equal(r.current.expenses,31000);assert.equal(r.forecast.days,31);
});
test('an explicitly supplied exact-model cost fills only missing cost, never changes source or known cost',()=>{
  const original=orders.map((o,n)=>n===0?{...o,items:[{...o.items[0],title:'Unpriced model',purchased_price:null,kind_hint:'unknown'}]}:o);
  const r=C.profitPlan(original,ads,plan,cfg,metadata,{...assumption,costOverrides:{'Unpriced model':1100,'Model':9999}});
  assert.equal(r.current.missingCostUnits,0);assert.equal(r.current.net,f().current.net-100);assert.equal(original[0].items[0].unit_cost,undefined);
  const unrelated=C.profitPlan(original,ads,plan,cfg,metadata,{...assumption,costOverrides:{'Unpriced':1100}});assert.equal(unrelated.current.net,null);
});
