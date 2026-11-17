const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../assets/summary-core.js'),S=require('../api/_summary-site.js');
const cfg={fx:44.5,standard:1500,thermal:1650,boot:1800,insole:65,overhead:150000,extra:0};
const order=(id=1,extra={})=>({id:'crm-'+id,keycrm_id:id,keycrm_status_id:23,created_at:'2026-11-12T12:00Z',total:9000,items:[{uid:'crm:1',title:'CRM REPLACEMENT',size:'45',qty:1,price:9000,unit_cost:1200,is_footwear:true,kind_hint:'standard'}],...extra});
const item=(extra={})=>({uid:'original',title:'Hunk3 allBlack',family:'Hunk3',size:'42',qty:1,price:4000,seasonId:'autumn',...extra});
const sum=orders=>C.summarize(orders,[],'2026-11-12','2026-11-13',cfg,{siteReady:true});
test('ranking, size detail and version totals use only original website lines; CRM finance stays unchanged',()=>{
  const orders=[order(),order(2,{keycrm_status_id:12,created_at:'2026-11-13T10:00Z'})],before=sum(orders);
  S.enrichVersions(orders,[{keycrm_id:1,status:'new',total:10500,items:[item({qty:2,seasonId:'winter',price:5000}),item({uid:'ins',family:'Insole',title:'Устілки',price:500})]},
    {keycrm_id:2,status:'new',total:3600,items:[item({size:'43'})]}]);
  const r=sum(orders),p=r.siteProducts[0];
  assert.equal(p.title,'Hunk3 allBlack');assert.equal(p.family,'Hunk3');assert.equal(p.qty,3);assert.equal(p.redeemedQty,1);
  assert.equal(p.revenue,13600);assert.equal(p.cost,4800);assert.equal(p.margin,8800);
  assert.deepEqual(p.sizes.map(s=>[s.size,s.kind,s.qty,s.redeemed,s.revenue]),[['42','thermal',2,0,10000],['43','standard',1,1,3600]]);
  assert.deepEqual(r.siteSizes,[{size:'42',qty:2},{size:'43',qty:1}]);
  assert.equal(r.siteVariants.reduce((s,v)=>s+v.qty,0),3);assert.equal(r.siteVariants.reduce((s,v)=>s+v.revenue,0),13600);
  assert.equal(r.originalModels.knownVersionPairs,3);assert.equal(r.siteProducts.length,1);
  for(const key of ['buckets','profit','aov','grossMargin','products','reconciliation'])assert.deepEqual(r[key],before[key]);
});
test('missing site amounts and unknown version stay unknown, not CRM prices or standard costs',()=>{
  const orders=[order()];S.enrichVersions(orders,[{keycrm_id:1,items:[item({seasonId:undefined})]}]);
  const p=sum(orders).siteProducts[0];assert.equal(p.revenue,null);assert.equal(p.cost,null);assert.equal(p.margin,null);
  assert.equal(p.sizes[0].revenue,null);assert.deepEqual(p.variants,[{kind:'unknown',qty:1}]);
  assert.equal(p.missingRevenueUnits,1);assert.equal(p.missingCostUnits,1);
});
test('site discounts reconcile to saved order cents and include accessory weight before excluding it',()=>{
  assert.deepEqual(S.allocateSiteRevenue([item(),item({price:1000})],4500),[3600,900]);
  assert.deepEqual(S.allocateSiteRevenue([item({price:1}),item({price:1}),item({price:1})],1),[0.34,0.33,0.33]);
  assert.deepEqual(S.allocateSiteRevenue([item({price:0}),item()],1),[0,1]);
  for(const total of [null,undefined,'',-1,Infinity])assert.deepEqual(S.allocateSiteRevenue([item()],total),[null]);
  assert.deepEqual(S.allocateSiteRevenue([item(),item({price:undefined})],5000),[null,null]);
});
test('draft snapshot cannot supply model identity or invoice association; latest final snapshot wins',()=>{
  const orders=[order()];const info=S.enrichVersions(orders,[{keycrm_id:1,status:'lead',items:[item({title:'DRAFT'})],payment_ref:'draft-ref'},
    {keycrm_id:1,status:'new',total:4000,items:[item()]},{keycrm_id:1,status:'new',total:4000,items:[item({title:'OLDER'})]}]);
  assert.equal(orders[0].site_items[0].title,'Hunk3 allBlack');assert.equal(info.refs.has('draft-ref'),false);
});
test('new, refused, test and unmatched CRM orders do not acquire a website model',()=>{
  const orders=[order(),order(2,{keycrm_status_id:1}),order(3,{keycrm_status_id:19}),order(4,{is_test:true}),order(5)];
  S.enrichVersions(orders,[1,2,3,4].map(keycrm_id=>({keycrm_id,status:'new',total:4000,items:[item()]})));
  const r=sum(orders);assert.equal(r.siteProducts[0].qty,1);assert.equal(r.originalModels.withoutSnapshotOrders,1);
});
test('read query excludes drafts and returns only model/amount fields plus existing invoice link',async()=>{
  await S.loadSiteRows(async(table,q)=>{assert.equal(table,'ulhome_orders');assert.equal(q.get('status'),'neq.lead');assert.match(q.get('select'),/total,status/);assert.ok(!q.get('select').includes('customer'));return [];},[order()]);
  const orders=[order()];S.enrichVersions(orders,[{keycrm_id:1,total:4000,items:[item({notes:'PRIVATE-NOTE',customer_phone:'PRIVATE-PHONE',cost:99,arbitrary:'PRIVATE-EXTRA'})]}]);
  assert.deepEqual(Object.keys(orders[0].site_items[0]).sort(),['family','is_footwear','kind_hint','qty','revenue','size','title','uid']);
  assert.ok(!JSON.stringify(orders[0].site_items).includes('PRIVATE'));
});
test('UI renders and exports website models, retains null amounts, and escapes stored titles',async()=>{
  const source=fs.readFileSync(require.resolve('../assets/summary-ui.js'),'utf8');new vm.Script(source);
  const orders=[order()];S.enrichVersions(orders,[{keycrm_id:1,items:[item({title:'<b>Original & safe</b>',seasonId:'winter'})]}]);
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',setAttribute(){},addEventListener(){}});return nodes.get(id);};
  let blob;
  const ctx={result:sum(orders),range:{from:'2026-11-12',to:'2026-11-13'},activeTab:'models',C,el:node,
    names:{standard:'Звичайна',thermal:'Низька термо',unknown:'Версію не вказано'},uah:n=>n===null?'—':String(n),pct:String,
    esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    Blob,URL:{createObjectURL:b=>{blob=b;return 'blob:fixture';},revokeObjectURL(){}},document:{createElement:()=>({click(){}})},setTimeout:fn=>fn()};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function modelSourceNote(){'),source.indexOf('  async function load(force){')),ctx);
  ctx.renderTab();assert.match(node('s-model-list').innerHTML,/Original &amp; safe/);assert.ok(!node('s-model-list').innerHTML.includes('CRM REPLACEMENT'));
  assert.match(node('s-pane').innerHTML,/Версію відомо для 1 із 1/);
  ctx.exportCSV();const csv=await blob.text();assert.match(csv,/UID сайту/);assert.match(csv,/Original & safe/);assert.match(csv,/"1";"0";""$/);
  ctx.activeTab='sizes';ctx.renderTab();assert.match(node('s-pane').innerHTML,/EU 42/);assert.ok(!node('s-pane').innerHTML.includes('EU 45'));
});
