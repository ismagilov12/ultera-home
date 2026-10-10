(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UlteraSummary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const APPROVED = new Set([2,3,4,5,8,9,11,12,22,23,24,26,27,28]);
  const REJECTED = new Set([6,7,15,19]);
  // Financial assumptions arrive only through the authenticated API.
  const DEFAULTS = Object.freeze({ fx:null, standard:null, thermal:null, boot:null, insole:null, overhead:null, extra:0 });
  const money = n => Math.round((Number(n)||0)*100)/100;
  const valid = n => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
  function day(value) {
    if (!value) return null;
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }
  function dates(from,to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from||'') || !/^\d{4}-\d{2}-\d{2}$/.test(to||'')) throw new Error('Некоректний період');
    const a=new Date(from+'T12:00:00Z'), b=new Date(to+'T12:00:00Z');
    if (!Number.isFinite(+a)||!Number.isFinite(+b)||a.toISOString().slice(0,10)!==from||b.toISOString().slice(0,10)!==to||a>b||(b-a)/86400000>365) throw new Error('Оберіть коректний період до 366 днів');
    const out=[];for(let t=+a;t<=+b;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));
    return out;
  }
  function previous(from,to) {const ds=dates(from,to),end=new Date(from+'T12:00Z').getTime()-86400000;return {from:new Date(end-(ds.length-1)*86400000).toISOString().slice(0,10),to:new Date(end).toISOString().slice(0,10)};}
  function settings(input) {
    const cfg={...DEFAULTS};
    for(const k of Object.keys(cfg))if(input&&k in input)cfg[k]=input[k]===''||input[k]===null?null:Number(input[k]);
    for(const k of ['fx','standard','thermal','boot','overhead','extra'])if(!valid(cfg[k])||cfg[k]<0||(k==='fx'&&cfg[k]===0))throw new Error('Перевірте курс і витрати');
    if(cfg.insole!==null&&(!valid(cfg.insole)||cfg.insole<0))throw new Error('Перевірте собівартість устілок');
    return cfg;
  }
  function status(o) {
    const id=Number(o.keycrm_status_id??o.status_id);
    if(id===99||o.excluded)return 'excluded';
    if(REJECTED.has(id))return 'rejected';
    if(id===12)return 'redeemed';
    if(APPROVED.has(id))return 'approved';
    if(id===1)return 'pending';
    if(o.keycrm_status_group==='rejected')return 'rejected';
    if(o.keycrm_status_group==='excluded')return 'excluded';
    if(o.keycrm_status_group==='approved')return 'approved';
    return 'unknown';
  }
  function kind(i) {
    const f=String(i.family||'').toLowerCase();
    const title=String(i.title||i.name||'').toLowerCase();
    if(f==='insole'||/устіл|стельк|insole/.test(title))return 'insole';
    if(f==='tees'||/футболк|t-shirt/.test(title))return 'other';
    if(/^(thermo|hunk thermo|aganta thermo|thermo ked|travel thermo|wave2 thermo)$/.test(f)||/(?:hunk|aganta|travel|wave2)\s*thermo|thermo\s*ked|термо\s*(бот|кед)/.test(title))return 'boot';
    if(i.seasonId==='winter'||/зим|winter|термо|thermo/.test(String(i.season||'')))return 'thermal';
    return 'standard';
  }
  function unitCost(i,cfg) {
    for(const k of ['unit_cost','purchased_price','cost'])if(valid(i[k])&&Number(i[k])>0)return {value:Number(i[k]),estimated:false};
    const k=kind(i), value=cfg[k];
    return {value:valid(value)?Number(value):null,estimated:true};
  }
  function footwear(i) {return kind(i)!=='insole'&&!/^(tees)$/i.test(String(i.family||''))&&!/футболк|t-shirt/i.test(String(i.title||i.name||''));}
  function campaign(value) {try{return decodeURIComponent(String(value||'').replace(/\+/g,' ')).trim()||'Без UTM';}catch{return String(value||'Без UTM');}}
  function normalize(input,cfg) {
    const out=[],byId=new Map(),excluded={leads:0,empty:0,duplicate:0,tests:0};
    for(const o of input||[]) {
      if(o.status==='lead'){excluded.leads++;continue;}
      if(o.is_test||o.excluded||status(o)==='excluded'){excluded.tests++;continue;}
      const items=Array.isArray(o.items)?o.items:[];
      if(!valid(o.total)||Number(o.total)<=0||!items.some(i=>Number(i.qty||i.quantity)>0)){excluded.empty++;continue;}
      const key=o.keycrm_id?'crm:'+o.keycrm_id:'site:'+o.id;
      if(byId.has(key)){excluded.duplicate++;const old=byId.get(key);if(new Date(o.updated_at||o.created_at)<=new Date(old.updated_at||old.created_at))continue;}
      byId.set(key,o);
    }
    for(const [key,o] of byId) {
      const lines=(o.items||[]).filter(i=>Number(i.qty||i.quantity)>0).map(i=>({...i,qty:Number(i.qty||i.quantity),price:Math.max(0,Number(i.price)||0)}));
      const raw=lines.reduce((s,i)=>s+i.qty*i.price,0),total=Number(o.total),st=status(o);
      let allocated=0;
      const normalizedLines=lines.map((i,index)=>{
        const c=unitCost(i,cfg),revenue=index===lines.length-1?money(total-allocated):money(raw?total*(i.qty*i.price/raw):total*i.qty/lines.reduce((s,l)=>s+l.qty,0));allocated+=revenue;
        const title=String(i.title||i.name||'Товар без назви').replace(/^ULTERA\s*[-–]\s*/i,'');
        return {uid:String(i.uid||i.sku||title),title,family:String(i.family||''),size:String(i.size||'Не вказано'),kind:kind(i),footwear:footwear(i),qty:i.qty,revenue,cost:c.value===null?null:money(c.value*i.qty),estimatedCost:c.estimated,photo:String(i.photo||'')};
      });
      out.push({id:key,number:o.keycrm_id||o.number,day:day(o.created_at),created_at:o.created_at,customer:String(o.customer_key||key),status:st,total,
        city:String(o.delivery_city||'Не вказано'),campaign:campaign(o.campaign_tag),lines:normalizedLines,synced:o.keycrm_synced_at||null});
    }
    return {orders:out,excluded};
  }
  function blank() {return {orders:0,customers:0,pairs:0,units:0,revenue:0,cost:0,missingCostUnits:0,estimatedCostUnits:0};}
  function accumulate(bucket,o) {bucket.orders++;bucket.revenue+=o.total;for(const i of o.lines){bucket.units+=i.qty;if(i.footwear)bucket.pairs+=i.qty;if(i.cost===null)bucket.missingCostUnits+=i.qty;else bucket.cost+=i.cost;if(i.estimatedCost&&i.cost!==null)bucket.estimatedCostUnits+=i.qty;}}
  function summarize(input,adRows,from,to,config,metadata) {
    const cfg=settings(config),ds=dates(from,to),norm=normalize(input,cfg),os=norm.orders.filter(o=>o.day>=from&&o.day<=to);
    metadata={...(metadata||{})};
    if((metadata.earliestOrderDate&&from<metadata.earliestOrderDate)||(metadata.latestOrderDate&&to>metadata.latestOrderDate))metadata.ordersComplete=false;
    const b={all:blank(),approved:blank(),redeemed:blank(),waiting:blank(),pending:blank(),rejected:blank(),unknown:blank()};
    const customers=Object.fromEntries(Object.keys(b).map(k=>[k,new Set()]));
    const products=new Map(),daily=new Map(ds.map(d=>[d,{date:d,approved:0,approvedCustomers:0,redeemed:0,revenue:0,redeemedRevenue:0,pairs:0,adSpend:null,adSpendUSD:null,aov:null,cac:null}]));
    const dailyCustomers=new Map(ds.map(d=>[d,new Set()]));
    const cities=new Map(),campaigns=new Map(),variants=new Map(),sizes=new Map();
    for(const o of os) {
      accumulate(b.all,o);customers.all.add(o.customer);
      const approved=o.status==='approved'||o.status==='redeemed';
      const groups=approved?['approved',o.status==='redeemed'?'redeemed':'waiting']:[o.status];
      for(const g of groups){accumulate(b[g],o);customers[g].add(o.customer);}
      if(!campaigns.has(o.campaign))campaigns.set(o.campaign,{name:o.campaign,submitted:0,approved:0,redeemed:0,revenue:0,customers:new Set(),approvedCustomers:new Set()});
      const cam=campaigns.get(o.campaign);cam.submitted++;cam.customers.add(o.customer);if(approved){cam.approved++;cam.revenue+=o.total;cam.approvedCustomers.add(o.customer);}if(o.status==='redeemed')cam.redeemed++;
      if(!approved)continue;
      const d=daily.get(o.day);d.approved++;d.revenue+=o.total;dailyCustomers.get(o.day).add(o.customer);if(o.status==='redeemed'){d.redeemed++;d.redeemedRevenue+=o.total;}
      if(!cities.has(o.city))cities.set(o.city,{name:o.city,orders:0,revenue:0});const city=cities.get(o.city);city.orders++;city.revenue+=o.total;
      for(const i of o.lines) {
        const productKey=i.uid;
        if(!products.has(productKey))products.set(productKey,{uid:i.uid,title:i.title,family:i.family,photo:i.photo,qty:0,redeemedQty:0,revenue:0,cost:0,missingCostUnits:0,estimatedCostUnits:0,sizes:new Map(),variants:new Map()});
        const p=products.get(productKey);p.qty+=i.qty;p.revenue+=i.revenue;p.cost+=i.cost||0;if(i.cost===null)p.missingCostUnits+=i.qty;if(i.estimatedCost&&i.cost!==null)p.estimatedCostUnits+=i.qty;if(o.status==='redeemed')p.redeemedQty+=i.qty;
        const sizeKey=i.size+'|'+i.kind;
        if(!p.sizes.has(sizeKey))p.sizes.set(sizeKey,{size:i.size,kind:i.kind,qty:0,redeemed:0,revenue:0});
        const sz=p.sizes.get(sizeKey);sz.qty+=i.qty;sz.revenue+=i.revenue;if(o.status==='redeemed')sz.redeemed+=i.qty;
        p.variants.set(i.kind,(p.variants.get(i.kind)||0)+i.qty);
        if(i.footwear){d.pairs+=i.qty;sizes.set(i.size,(sizes.get(i.size)||0)+i.qty);}
        if(!variants.has(i.kind))variants.set(i.kind,{kind:i.kind,qty:0,revenue:0,cost:0,missing:0});
        const v=variants.get(i.kind);v.qty+=i.qty;v.revenue+=i.revenue;v.cost+=i.cost||0;if(i.cost===null)v.missing+=i.qty;
      }
    }
    for(const k of Object.keys(b)){b[k].customers=customers[k].size;b[k].revenue=money(b[k].revenue);b[k].cost=money(b[k].cost);}
    const ads=new Map((adRows||[]).filter(r=>r.account_id==='1095942551692734'&&r.timezone==='Europe/Kyiv').map(r=>[r.date,r]));
    const missingAdDays=ds.filter(d=>!ads.has(d)||!valid(ads.get(d).spend_usd));
    const spendUSD=money(ds.reduce((s,d)=>s+(valid(ads.get(d)?.spend_usd)?Number(ads.get(d).spend_usd):0),0)),spend=money(spendUSD*cfg.fx);
    for(const d of ds){
      const row=daily.get(d);
      row.approvedCustomers=dailyCustomers.get(d).size;
      row.revenue=money(row.revenue);row.redeemedRevenue=money(row.redeemedRevenue);
      if(valid(ads.get(d)?.spend_usd)){row.adSpendUSD=money(Number(ads.get(d).spend_usd));row.adSpend=money(Number(ads.get(d).spend_usd)*cfg.fx);}
      // A gap in another day's ads must not hide this day's verified values.
      // No approvals means an undefined ratio, never a zero-cost customer.
      if(metadata.ordersComplete!==false){
        row.aov=row.approved?money(row.revenue/row.approved):null;
        row.cac=row.approvedCustomers&&row.adSpend!==null?money(row.adSpend/row.approvedCustomers):null;
      }
    }
    const overhead=money(ds.reduce((s,d)=>{const dt=new Date(d+'T12:00Z');return s+cfg.overhead/new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,0)).getUTCDate();},0));
    const coverageOK=!missingAdDays.length&&(!metadata||metadata.ordersComplete!==false);
    function profit(group){return coverageOK&&!b[group].missingCostUnits?money(b[group].revenue-b[group].cost-spend-overhead-cfg.extra):null;}
    return {from,to,days:ds.length,settings:cfg,buckets:b,excluded:norm.excluded,
      advertising:{usd:spendUSD,uah:spend,missingDays:missingAdDays,coveredDays:ds.length-missingAdDays.length,complete:!missingAdDays.length},
      overhead,extra:cfg.extra,profit:{expected:profit('approved'),redeemed:profit('redeemed')},
      aov:b.approved.orders?money(b.approved.revenue/b.approved.orders):null,
      approvalRate:b.all.orders?b.approved.orders/b.all.orders:null,customerApprovalRate:b.all.customers?b.approved.customers/b.all.customers:null,
      redemptionRate:b.approved.orders?b.redeemed.orders/b.approved.orders:null,
      cpo:coverageOK&&b.approved.orders?money(spend/b.approved.orders):null,
      cac:coverageOK&&b.approved.customers?money(spend/b.approved.customers):null,
      roas:coverageOK&&spend>0?b.approved.revenue/spend:null,
      grossMargin:b.approved.missingCostUnits?null:money(b.approved.revenue-b.approved.cost),
      grossMarginRate:b.approved.missingCostUnits||!b.approved.revenue?null:(b.approved.revenue-b.approved.cost)/b.approved.revenue,
      thermalShare:b.approved.pairs?[...variants.values()].filter(v=>v.kind==='thermal'||v.kind==='boot').reduce((s,v)=>s+v.qty,0)/b.approved.pairs:null,
      daily:[...daily.values()],products:[...products.values()].map(p=>({...p,revenue:money(p.revenue),cost:money(p.cost),margin:p.missingCostUnits?null:money(p.revenue-p.cost),sizes:[...p.sizes.values()].sort((a,b)=>a.size.localeCompare(b.size,'uk',{numeric:true})||a.kind.localeCompare(b.kind)),variants:[...p.variants].map(([kind,qty])=>({kind,qty}))})).sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue),
      sizes:[...sizes].map(([size,qty])=>({size,qty})).sort((a,b)=>a.size.localeCompare(b.size,'uk',{numeric:true})),
      variants:[...variants.values()],cities:[...cities.values()].sort((a,b)=>b.orders-a.orders),
      campaigns:[...campaigns.values()].map(c=>({...c,customers:c.customers.size,approvedCustomers:c.approvedCustomers.size})).sort((a,b)=>b.approved-a.approved),metadata:metadata||{}};
  }
  return {DEFAULTS,money,day,dates,previous,settings,status,kind,footwear,unitCost,normalize,summarize};
});
