'use strict';
// Read-only enrichment. Site snapshots supply original models/versions and invoice links,
// never CRM approval, revenue or current fulfillment truth.
const crypto=require('node:crypto');
const finite=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n));
const money=n=>Math.round(n*100)/100;
const BOOT_UIDS=new Set(['550020261003','590020261003','590020261004']);
const INSTALLMENT_SYSTEMS=new Set(['payparts','paypartsmono','paypartsprivat','paypartsabank','instantabank','globusplus','paypartsotp','paypartspumb','paypartskredit']);
const keyPart=n=>String(n??'').trim();
function siteSku(item){const uid=keyPart(item.uid);const size=keyPart(item.size).match(/^(4[0-5])(?:\D|$)/)?.[1];return BOOT_UIDS.has(uid)&&size?uid+'-'+size:uid;}
function siteKind(item){
  const label=String(item.season||''),family=String(item.family||''),season=String(item.seasonId||item.season_id||'').toLowerCase();
  if(/устіл|стельк|insole/i.test(family+' '+item.title))return 'insole';
  if(/^(tees)$/i.test(family)||/футболк|t-shirt/i.test(String(item.title||'')))return 'other';
  if(BOOT_UIDS.has(keyPart(item.uid))||/^(thermo|hunk thermo|aganta thermo|thermo ked|travel thermo|wave2 thermo)$/i.test(family))return 'boot';
  if(season==='winter'||/зим|winter|термо|thermo/i.test(label))return 'thermal';
  if(['autumn','spring','summer'].includes(season)||/осін|осен|весн|демі|деми|літн|летн|autumn|spring|summer/i.test(label))return 'standard';
  return 'unknown';
}
async function loadSiteRows(rest,orders){
  const ids=[...new Set(orders.map(o=>Number(o.keycrm_id)).filter(n=>Number.isSafeInteger(n)&&n>0))],rows=[];
  for(let i=0;i<ids.length;i+=75){
    const batch=await rest('ulhome_orders',new URLSearchParams({select:'keycrm_id,items,payment_ref,created_at',keycrm_id:'in.('+ids.slice(i,i+75).join(',')+')',order:'created_at.desc',limit:'1000'}));
    if(batch.length>=1000)throw new Error('Site links may be incomplete');
    rows.push(...batch);
  }
  return rows;
}
function enrichVersions(orders,siteRows){
  const byOrder=new Map(),refs=new Map();let matchedLines=0;
  for(const row of siteRows){
    const id=String(row.keycrm_id);if(!byOrder.has(id))byOrder.set(id,row);
    const ref=keyPart(row.payment_ref);if(ref){if(!refs.has(ref))refs.set(ref,new Set());refs.get(ref).add(id);}
  }
  for(const order of orders){
    const row=byOrder.get(String(order.keycrm_id));if(!row||!Array.isArray(row.items))continue;
    // Explicit allowlist only. Do not copy arbitrary stored JSON, notes, URLs or PII.
    // Model identity/title come from the order snapshot, never the current catalog/CRM.
    order.site_items=row.items.flatMap(item=>{
      const qty=Number(item.qty??item.quantity),uid=keyPart(item.uid),title=keyPart(item.title||item.name),kind=siteKind(item);
      if(!Number.isSafeInteger(qty)||qty<=0||!uid||!title||['insole','other'].includes(kind))return [];
      return [{uid:uid.slice(0,160),title:title.slice(0,300),size:keyPart(item.size).slice(0,80)||'Не вказано',qty,kind_hint:kind,is_footwear:true}];
    });
    // Original site selection is a separate measure: a manager can replace the CRM SKU
    // or size. Never mislabel the current CRM line using an approximate model match.
    const original=row.items.map(i=>({qty:Number(i.qty??i.quantity),kind:siteKind(i)}));
    if(original.every(i=>Number.isSafeInteger(i.qty)&&i.qty>0)){
      const footwear=original.filter(i=>!['insole','other'].includes(i.kind));
      order.site_version={pairs:footwear.reduce((s,i)=>s+i.qty,0),knownPairs:footwear.filter(i=>i.kind!=='unknown').reduce((s,i)=>s+i.qty,0),thermalPairs:footwear.filter(i=>i.kind==='thermal'||i.kind==='boot').reduce((s,i)=>s+i.qty,0)};
    }
    const groups=new Map(),crmGroups=new Map();
    for(const item of row.items){
      const qty=Number(item.qty??item.quantity);if(!(qty>0))continue;
      const key=siteSku(item)+'|'+keyPart(item.size);if(!groups.has(key))groups.set(key,{qty:0,kinds:new Set()});
      const group=groups.get(key);group.qty+=qty;group.kinds.add(siteKind(item));
    }
    for(const item of order.items){const key=keyPart(item.sku)+'|'+keyPart(item.size);crmGroups.set(key,(crmGroups.get(key)||0)+Number(item.qty));}
    for(const item of order.items){
      if(!item.is_footwear||!item.sku)continue;
      const key=keyPart(item.sku)+'|'+keyPart(item.size),group=groups.get(key);
      if(!group||group.qty!==crmGroups.get(key)||group.kinds.size!==1)continue;
      const kind=[...group.kinds][0];if(kind==='unknown'||kind==='insole')continue;
      item.kind_hint=kind;item.kind_source='site';matchedLines++;
    }
  }
  return {refs,matchedLines};
}
function compactTransactions(rows){
  const latest=new Map();
  for(const row of rows){
    const ref=keyPart(row.orderReference);if(!ref)continue;
    const updated=Number(row.processingDate||row.createdDate)||0;
    const old=latest.get(ref);if(old&&old.updated>updated)continue;
    // Never retain or return card, payer, signature, delivery or arbitrary provider data.
    const type=keyPart(row.transactionType).toUpperCase();
    const status=/REFUND|VOID/.test(type)?'Refunded':type==='PURCHASE'?keyPart(row.transactionStatus):'Unknown';
    latest.set(ref,{ref,status,amount:finite(row.amount)?Number(row.amount):null,currency:keyPart(row.currency),system:keyPart(row.paymentSystem),updated});
  }
  return [...latest.values()];
}
async function loadWayfp({fetcher,env,start,end}){
  if(!env.WAYFORPAY_MERCHANT||!env.WAYFORPAY_SECRET)throw new Error('WayForPay not configured');
  const first=Math.floor(Date.parse(start)/1000)-86400,last=Math.floor(Date.parse(end)/1000);
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<first||last-first>122*86400)throw new Error('WayForPay range too large');
  const rows=[];
  for(let begin=first;begin<=last;begin+=29*86400){
    const finish=Math.min(last,begin+29*86400-1),account=env.WAYFORPAY_MERCHANT;
    const signature=crypto.createHmac('md5',env.WAYFORPAY_SECRET).update([account,begin,finish].join(';'),'utf8').digest('hex');
    const response=await fetcher('https://api.wayforpay.com/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiVersion:1,transactionType:'TRANSACTION_LIST',merchantAccount:account,merchantSignature:signature,dateBegin:begin,dateEnd:finish}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('WayForPay unavailable');
    const body=await response.json();if(Number(body.reasonCode)!==1100||!Array.isArray(body.transactionList))throw new Error('WayForPay response invalid');
    rows.push(...compactTransactions(body.transactionList));
  }
  // Re-deduplicate overlap/provider retries across chunks.
  const latest=new Map();for(const row of rows)if(!latest.has(row.ref)||latest.get(row.ref).updated<=row.updated)latest.set(row.ref,row);
  return [...latest.values()];
}
function mergePayments(orders,refs,transactions,wfpReady){
  const byOrder=new Map();let unmatchedInstallments=0;
  for(const t of transactions){
    const ids=refs.get(t.ref),installment=INSTALLMENT_SYSTEMS.has(t.system.toLowerCase());
    if(!ids||ids.size!==1){if(t.status==='Approved'&&installment)unmatchedInstallments++;continue;}
    const id=[...ids][0];if(!byOrder.has(id))byOrder.set(id,[]);byOrder.get(id).push(t);
  }
  for(const o of orders){
    const rows=byOrder.get(String(o.keycrm_id))||[],approved=rows.filter(r=>r.status==='Approved'&&r.currency==='UAH'&&finite(r.amount)&&r.amount>0);
    const reversal=rows.some(r=>/refund|void|chargeback|revers/i.test(r.status));
    const bankAmount=money(approved.reduce((s,t)=>s+t.amount,0)),crm=o.payment||{known:false,paidAmount:null};
    const known=!reversal&&(crm.known||approved.length>0);
    o.payment={known,paidAmount:known?money(Math.max(crm.known?crm.paidAmount:0,bankAmount)):null,
      installment:!reversal&&approved.some(t=>INSTALLMENT_SYSTEMS.has(t.system.toLowerCase())),wfpPaid:!reversal&&approved.length>0,wfpVerified:wfpReady,
      wfpAmount:bankAmount,source:approved.length?'KeyCRM + WayForPay':'KeyCRM'};
  }
  return {unmatchedInstallments};
}
module.exports={loadSiteRows,enrichVersions,loadWayfp,compactTransactions,mergePayments,siteSku,siteKind,INSTALLMENT_SYSTEMS};

