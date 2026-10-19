const test=require('node:test'),assert=require('node:assert/strict');
const {paymentSummary}=require('../api/_summary-keycrm.js');
const S=require('../api/_summary-site.js'),C=require('../assets/summary-core.js');
const cfg={fx:44.5,standard:1500,thermal:1650,boot:1800,insole:65,overhead:0,extra:0};
const order=(id=1,more={})=>({id:'crm-'+id,keycrm_id:id,keycrm_status_id:23,created_at:'2026-10-09T12:00Z',total:4490,items:[{uid:'crm-product:1',sku:'123',title:'Model',size:'42',qty:1,price:4490,is_footwear:true,kind_hint:'unknown'}],...more});
const sum=os=>C.summarize(os,[],'2026-10-09','2026-10-09',cfg,{payments:{wfpReady:true}});
const txn=(more={})=>({transactionType:'PURCHASE',orderReference:'ULT-test',transactionStatus:'Approved',amount:4490,currency:'UAH',paymentSystem:'payPartsMono',createdDate:1,processingDate:2,...more});
test('CRM payments use only paid records, deduplicate IDs, require amount and UAH',()=>{
  const paid={id:1,status:'paid',amount:200,actual_currency:'UAH'};
  assert.deepEqual(paymentSummary({payments:[paid,paid,{id:2,status:'not_paid',amount:4490},{id:3,status:'canceled',amount:500}]},'UAH'),{known:true,paidAmount:200});
  assert.equal(paymentSummary({payments:[{status:'paid',amount:null}]},'UAH').known,false);
  assert.equal(paymentSummary({payments:[{status:'paid',amount:200,actual_currency:'USD'}]},'UAH').known,false);
  assert.equal(paymentSummary({payment_status:'paid'},'UAH').known,false);
  assert.deepEqual(paymentSummary({payments:[]},'UAH'),{known:true,paidAmount:0});
});
test('payment buckets are disjoint and include only approvals, with exactly 200 minimum',()=>{
  const os=[4490,200,500,0,null].map((amount,i)=>order(i+1,{payment:{known:amount!==null,paidAmount:amount}}));
  os.push(order(6,{keycrm_status_id:1,payment:{known:true,paidAmount:4490}}));
  os.push(order(7,{keycrm_status_id:19,payment:{known:true,paidAmount:200}}));
  const p=sum(os).payments;assert.equal(p.orders,5);
  assert.deepEqual([p.full,p.minimum,p.partial,p.unpaid,p.unknown],[1,1,1,1,1]);assert.equal(p.receivedAmount,5190);
  assert.equal(sum([order(1,{total:200,payment:{known:true,paidAmount:200}})]).payments.full,1);
  assert.equal(sum([order(1,{payment:{known:true,paidAmount:200.01}})]).payments.minimum,0);
});
test('selected payment option or redeemed status does not establish payment',()=>{
  const p=sum([order(1,{keycrm_status_id:12,payment_method:'payPartsMono',payment_status:'paid'})]).payments;
  assert.equal(p.full,0);assert.equal(p.installments,0);assert.equal(p.unknown,1);
});
test('site primary version requires exact CRM ID, sku, size and total quantity',()=>{
  const os=[order(),order(2,{items:[{...order().items[0],sku:'456'}]})];
  const rows=[{keycrm_id:1,payment_ref:'ULT-1',items:[{uid:'123',size:'42',qty:1,season_id:'winter'}]},{keycrm_id:2,items:[{uid:'456',size:'43',qty:1,season_id:'winter'}]}];
  assert.equal(S.enrichVersions(os,rows).matchedLines,1);assert.equal(os[0].items[0].kind_hint,'thermal');assert.equal(os[0].items[0].kind_source,'site');assert.equal(os[1].items[0].kind_hint,'unknown');
  const s=sum(os);assert.equal(s.thermalKnownPairs,1);assert.equal(s.thermalPairs,1);assert.equal(s.thermalShare,1);assert.equal(s.quality.unknownVersionPairs,1);
});
test('ambiguous seasons, missing data, mismatched quantity and unrelated orders are not guessed',()=>{
  for(const items of [[{uid:'123',size:'42',qty:2,season_id:'winter'}],[{uid:'123',size:'42',qty:.5,season_id:'winter'},{uid:'123',size:'42',qty:.5,season_id:'autumn'}],[{uid:'123',size:'42',qty:1}],[{uid:'999',size:'42',qty:1,season_id:'winter'}]]){
    const os=[order()];S.enrichVersions(os,[{keycrm_id:1,items}]);assert.equal(os[0].items[0].kind_hint,'unknown');
  }
  assert.equal(sum([order()]).thermalShare,null);
  assert.equal(S.siteKind({uid:'550020261003',family:'Hunk Thermo'}),'boot');assert.equal(S.siteSku({uid:'550020261003',size:42}),'550020261003-42');assert.equal(S.siteKind({season:'Осінь'}),'standard');
});
test('truncated site links fail closed rather than pretending complete',async()=>{
  await assert.rejects(S.loadSiteRows(async()=>Array(1000).fill({keycrm_id:1}),[order()]),/incomplete/);
});
test('gateway compaction strips payer/card fields and recognizes refund transaction types',()=>{
  const rows=S.compactTransactions([txn({cardPan:'SECRET-CARD',email:'SECRET-EMAIL',merchantSignature:'SECRET-SIG'}),txn({orderReference:'ULT-2',transactionType:'REFUND',transactionStatus:'Approved'})]);
  assert.equal(rows[0].status,'Approved');assert.equal(rows[1].status,'Refunded');assert.ok(!JSON.stringify(rows).includes('SECRET'));
  assert.equal(S.compactTransactions([txn({transactionType:undefined})])[0].status,'Unknown');
});
test('gateway payments link only unique exact invoice reference and never double CRM amount',()=>{
  const os=[order(1,{payment:{known:true,paidAmount:4490}}),order(2,{payment:{known:true,paidAmount:0}})];
  const refs=new Map([['ULT-test',new Set(['1'])],['ULT-ambiguous',new Set(['1','2'])]]);
  S.mergePayments(os,refs,S.compactTransactions([txn(),txn({orderReference:'ULT-ambiguous'})]),true);
  assert.equal(os[0].payment.paidAmount,4490);assert.equal(os[1].payment.paidAmount,0);
  const p=sum(os).payments;assert.equal(p.full,1);assert.equal(p.installments,1);assert.equal(p.installmentsFull,1);assert.equal(p.wfpPaidOrders,1);assert.equal(p.receivedAmount,4490);
});
test('declined, missing currency, pending and refunded transactions never count installments',()=>{
  for(const t of [txn({transactionStatus:'Declined'}),txn({transactionStatus:'Pending'}),txn({currency:'USD'}),txn({transactionType:'REFUND'})]){
    const os=[order(1,{payment:{known:true,paidAmount:0}})];S.mergePayments(os,new Map([['ULT-test',new Set(['1'])]]),S.compactTransactions([t]),true);assert.equal(sum(os).payments.installments,0);
  }
  const os=[order(1,{payment:{known:true,paidAmount:4490}})];S.mergePayments(os,new Map([['ULT-test',new Set(['1'])]]),S.compactTransactions([txn(),txn({transactionType:'REFUND',processingDate:3})]),true);assert.equal(sum(os).payments.unknown,1);
});
test('gateway reads use existing server credentials and only TRANSACTION_LIST, never charge',async()=>{
  let calls=0;const rows=await S.loadWayfp({env:{WAYFORPAY_MERCHANT:'fixture',WAYFORPAY_SECRET:'not-a-real-secret'},start:'2026-10-01T00:00Z',end:'2026-10-14T12:00Z',fetcher:async(url,options)=>{
    calls++;assert.equal(url,'https://api.wayforpay.com/api');const body=JSON.parse(options.body);assert.equal(body.transactionType,'TRANSACTION_LIST');assert.equal(body.merchantAccount,'fixture');assert.match(body.merchantSignature,/^[a-f0-9]{32}$/);return {ok:true,json:async()=>({reasonCode:1100,transactionList:[txn()]})};
  }});assert.equal(calls,1);assert.equal(rows[0].status,'Approved');assert.ok(!JSON.stringify(rows).includes('not-a-real-secret'));
  await assert.rejects(S.loadWayfp({env:{},start:'2026-10-01',end:'2026-10-14'}),/not configured/);
});
test('installments include only positively confirmed actual bank methods, not card payments',()=>{
  const os=[order(1,{payment:{known:false,paidAmount:null}})];S.mergePayments(os,new Map([['ULT-test',new Set(['1'])]]),S.compactTransactions([txn({paymentSystem:'card',amount:200})]),true);
  const p=sum(os).payments;assert.equal(p.minimum,1);assert.equal(p.installments,0);
});
test('primary site version survives CRM SKU and size replacement without relabeling current items',()=>{
  const os=[order(1,{items:[{...order().items[0],sku:'Internal model 44',size:'44'}]})];
  S.enrichVersions(os,[{keycrm_id:1,items:[{uid:'123',size:'43',qty:1,season_id:'winter'},{uid:'ins',family:'Insole',size:'43',qty:1}]}]);
  assert.equal(os[0].items[0].kind_hint,'unknown');assert.equal(os[0].items[0].size,'44');assert.equal(os[0].items[0].sku,'Internal model 44');
  const r=sum(os);assert.deepEqual(r.primaryVersions,{orders:1,pairs:1,knownPairs:1,thermalPairs:1,unknownPairs:0,share:1});assert.equal(r.buckets.approved.pairs,1);
});
test('primary thermal denominator excludes missing versions and manual orders, never counts refusals',()=>{
  const os=[order(1),order(2),order(3),order(4,{keycrm_status_id:19})];
  S.enrichVersions(os,[{keycrm_id:1,items:[{uid:'123',size:42,qty:2,season:'Осінь'}]},{keycrm_id:2,items:[{uid:'123',size:42,qty:1}]},{keycrm_id:4,items:[{uid:'123',size:42,qty:1,season:'Зима'}]}]);
  const r=sum(os);assert.equal(r.primaryVersions.orders,2);assert.equal(r.primaryVersions.pairs,3);assert.equal(r.primaryVersions.knownPairs,2);assert.equal(r.primaryVersions.unknownPairs,1);assert.equal(r.primaryVersions.share,0);assert.equal(r.buckets.approved.orders,3);
});
