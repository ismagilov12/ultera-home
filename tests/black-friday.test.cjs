const test = require('node:test');
const assert = require('node:assert/strict');
const order = require('../api/order');
const payment = require('../api/wayforpay');
const catalogue = require('../api/black-friday');
const arrivals = require('../lib/black-friday-nov23.cjs');

const pair = {uid:'bf26-07-slip-on-black-suede-42', title:'Сліпони', size:'42', qty:1, price:999, saleItem:true, promo_pct:30};
const regular = {uid:'regular', title:'Regular', size:'42', qty:1, price:2000};
const body = {num:'ULT-BF-abcd1234abcd1234', fio:'Fixture', phone:'fixture', payment:'card', promoCode:'SALE1'};
const reply = (data, status = 200) => new Response(JSON.stringify(data), {status});

function setup(t, upstream) {
  for (const [key,value] of Object.entries({
    SUPABASE_URL:'https://store.example.invalid', SUPABASE_SERVICE_ROLE_KEY:'fixture',
    KEYCRM_TOKEN:'fixture', WAYFORPAY_MERCHANT:'fixture', WAYFORPAY_SECRET:'fixture', TURNSTILE_SECRET:''
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/check_and_increment_rate_limit')) return reply({allowed:true});
    if (path.endsWith('/compute_order_total')) {
      const input = JSON.parse(opts.body).p_items;
      const breakdown = input.map(line => {
        const campaignPrices = {'bfoffer-aganta-thermo-oreo':4890, 'bfoffer-hunk-thermo-black':4890,
          'bfoffer-aganta-aqva':3890, 'bfoffer-aganta-salvia':3890};
        const unit = campaignPrices[line.uid] ?? (arrivals.has(line.uid) ? 1990 : line.uid === pair.uid ? pair.price : regular.price);
        if (line.uid.startsWith('bf26-')) assert.equal(line.promo_pct,0);
        return {...line, unit_price:unit, line_total:unit*line.qty};
      });
      return reply({ok:true, breakdown, total:breakdown.reduce((n,line)=>n+line.line_total,0)});
    }
    return upstream(path,opts);
  });
}
async function invoke(handler, input) {
  const result = {setHeader(){}, status(code){ this.code = code; return this; }, json(data){ this.body = data; }};
  await handler({method:'POST',headers:{},body:input},result);
  return result;
}

test('campaign cards use the recorded insole length and season while stock remains keyed by EU size', async t => {
  setup(t, path => {
    if (path.endsWith('/ulhome_products')) return reply([
      {uid:'bf26-leo', title:'Hunk Leo', article:'ЮА 1', category:'ULTERA;Осінь', size_list:[{eu:'40',cm:'26'}]},
      {uid:'bf26-other', article:null, category:'Розпродаж', size_list:[{eu:'41'}]},
      {uid:'bf26-thermo', article:'Thermo', category:'ULTERA;Зима', price:4890, price_old:5600,
       size_list:[{eu:'40',cm:26},{eu:'41',cm:27},{eu:'45',cm:30}]},
      {uid:'bf26-unlisted', size_list:[{eu:'42'}]}
    ]);
    if (path.endsWith('/ulhome_sale_stock')) return reply([
      {uid:'bf26-leo',size:'40',qty:1},{uid:'bf26-other',size:'41',qty:0},
      {uid:'bf26-thermo',size:'40',qty:0},{uid:'bf26-thermo',size:'41',qty:1}
    ]);
    assert.fail(path);
  });
  const res = {setHeader(){}, status(code){ this.code=code; return this; }, json(body){ this.body=body; }};
  await catalogue({method:'GET'},res);
  assert.equal(res.code,200);
  assert.deepEqual(res.body.items.map(({size,cm,season,article,available})=>({size,cm,season,article,available})),[
    {size:'40',cm:26,season:'Осінь',article:'ЮА 1',available:true},
    {size:'41',cm:27,season:'Зима',article:'Thermo',available:true}
  ]);
  assert.deepEqual(res.body.items[1].variants,[{size:'41',cm:27,available:true}]);
  assert.equal(res.body.items[1].oldPrice,5600);
});

test('a new card exposes only its free sizes, with the original image and exact available quantities', async t => {
  const green=arrivals.get('bf26-n23-ua1-brf-pistachio'), red=arrivals.get('bf26-n23-ua10-bordeaux-39');
  setup(t, path=>{
    if(path.endsWith('/ulhome_products')) return reply([green,red].map(item=>({
      uid:item.uid, article:item.article, title:item.title, photo:item.photo, size_list:item.sizes, price:1990
    })));
    if(path.endsWith('/ulhome_sale_stock')) return reply([
      {uid:green.uid,size:'37',qty:0},{uid:green.uid,size:'40',qty:1},{uid:green.uid,size:'44',qty:1},
      {uid:red.uid,size:'39',qty:2}
    ]);
    assert.fail(path);
  });
  const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;}};
  await catalogue({method:'GET'},res);
  assert.equal(res.code,200);
  const [first, second]=res.data.items;
  assert.equal(first.batch,'nov23');
  assert.equal(first.price,1990);
  assert.equal(first.pairPhoto,green.original);
  assert.deepEqual(first.variants.map(v=>[v.size,v.cm,v.quantity]),[['40',26,1],['44',29,1]]);
  assert.deepEqual(second.variants.map(v=>[v.size,v.cm,v.quantity]),[['39',25.5,2]]);
});

test('two burgundy pairs keep their fixed unit price in the order, CRM and card payment', async t => {
  const red=arrivals.get('bf26-n23-ua10-bordeaux-39');
  const line={uid:red.uid,title:red.title,size:'39',qty:2,price:1990,saleItem:true,promo_pct:30};
  let saved, crm;
  setup(t,(path,opts)=>{
    if(path.endsWith('/ulhome_orders')){
      if(opts.method==='PATCH') return reply({});
      saved=JSON.parse(opts.body);
      return reply([{id:saved.id,number:125}]);
    }
    if(path.endsWith('/ulhome_products')) return reply([red]);
    if(path==='/v1/order') {crm=JSON.parse(opts.body);return reply({id:125});}
    assert.fail(path);
  });
  const cart={...body,items:[line]};
  assert.equal((await invoke(order,cart)).code,200);
  assert.equal(saved.total,3980);
  assert.deepEqual(crm.products.map(p=>[p.price,p.quantity]),[[1990,2]]);
  const confirmation=await invoke(payment,{...cart,orderReference:body.num});
  assert.equal(confirmation.code,200);
  assert.equal(confirmation.body.chargedAmount,3980);
});

test('a sold pair stops checkout before CRM and legacy deductions', async t => {
  const calls = [];
  setup(t, (path,opts) => {
    calls.push(path);
    if (path.endsWith('/ulhome_orders') && opts.method === 'POST') return reply({message:'black_friday_unavailable'},400);
    if (path.endsWith('/ulhome_orders')) return reply([]);
    assert.fail(path);
  });
  const result = await invoke(order,{...body,items:[pair]});
  assert.equal(result.code,409);
  assert.equal(result.body.code,'pair_unavailable');
  assert.deepEqual(calls,['/rest/v1/ulhome_orders','/rest/v1/ulhome_orders']);
});

test('all four unlimited offers keep their colour, eligible sizes and campaign price on retries', async t => {
  const oreo={uid:'bfoffer-aganta-thermo-oreo',size:'44',qty:2,price:4890,saleItem:true};
  const hunk={uid:'bfoffer-hunk-thermo-black',size:'45',qty:3,price:4890,saleItem:true};
  const aqva={uid:'bfoffer-aganta-aqva',size:'45',qty:1,price:3890,saleItem:true};
  const salvia={uid:'bfoffer-aganta-salvia',size:'40',qty:2,price:3890,saleItem:true};
  const sizes=['40','41','42','43','44','45'].map(eu=>({eu,qty:'9999'}));
  let saved, crm, orderWrites=0;
  setup(t,(path,opts)=>{
    if (path.endsWith('/ulhome_products')) return reply([
      {uid:'550020261103',published:true,size_list:sizes},{uid:'550020260917',published:true,size_list:sizes},
      {uid:'260203663062',published:true,size_list:sizes},{uid:'977627506822',published:true,size_list:sizes}
    ]);
    if (path.endsWith('/ulhome_orders')) {
      if (opts.method==='PATCH') return reply({});
      if (opts.method==='POST') {
        const incoming=JSON.parse(opts.body);
        if(saved) {
          assert.equal(incoming.id,saved.id);
          return reply({message:'duplicate key value violates unique constraint "ulhome_orders_pkey"'},409);
        }
        saved=incoming; orderWrites++; return reply([{id:incoming.id,number:324}]);
      }
      return reply([{...saved, number:324}]);
    }
    if(path==='/v1/order'){crm=JSON.parse(opts.body); return reply({id:324});}
    assert.fail(path);
  });
  const ineligible={...body,items:[{...oreo,size:'45'}]};
  assert.equal((await invoke(order,ineligible)).code,409);
  assert.equal((await invoke(payment,{...ineligible,orderReference:body.num})).code,409);
  assert.equal(orderWrites,0);
  const cart={...body,items:[oreo,hunk,aqva,salvia]};
  assert.equal((await invoke(order,cart)).code,200);
  assert.equal(saved.total,36120);
  assert.deepEqual(crm.products.map(x=>[x.sku,x.price,x.quantity]),[
    ['550020261103',4890,2],['550020260917',4890,3],['260203663062',3890,1],['977627506822',3890,2]
  ]);
  assert.equal((await invoke(order,cart)).body.supabase_order,324);
  assert.equal(orderWrites,1);
  const charge=await invoke(payment,{...cart,orderReference:body.num});
  assert.equal(charge.body.chargedAmount,36120);
  assert.deepEqual(charge.body.formData.productPrice,['4890.00','4890.00','3890.00','3890.00']);
});

test('a repeated campaign checkout recovers the same saved order', async t => {
  setup(t,(path,opts) => {
    assert.ok(path.endsWith('/ulhome_orders'));
    if(opts.method==='POST') return reply({message:'black_friday_unavailable'},400);
    return reply([{customer_phone:body.phone,payment_method:'card',items:[pair],total:999,number:123}]);
  });
  const result=await invoke(order,{...body,items:[pair]});
  assert.equal(result.code,200);
  assert.equal(result.body.supabase_order,123);
});

test('checkout, CRM and payment keep campaign price fixed in a mixed cart', async t => {
  let savedTotal, crmPrices, legacyUids;
  setup(t, (path,opts) => {
    if (path.endsWith('/ulhome_orders')) {
      if (opts.method==='PATCH') return reply({});
      savedTotal = JSON.parse(opts.body).total;
      return reply([{id:'fixture',number:123}]);
    }
    if (path.endsWith('/ulhome_sale_stock_decrement')) {
      legacyUids = JSON.parse(opts.body).p_items.map(x=>x.uid);
      return reply({changed:[]});
    }
    if (path==='/v1/order') {
      crmPrices=JSON.parse(opts.body).products.map(x=>x.price);
      return reply({id:123});
    }
    if (path.endsWith('/ulhome_products')) return reply([pair,regular]);
    assert.fail(path);
  });
  const input = {...body, items:[pair,regular]};
  const placed = await invoke(order,input);
  assert.equal(placed.code,200);
  assert.equal(savedTotal,2899);
  assert.deepEqual(crmPrices,[999,1900]);
  assert.deepEqual(legacyUids,[regular.uid]);
  const charged=await invoke(payment,{...input,orderReference:body.num});
  assert.equal(charged.code,200);
  assert.equal(charged.body.chargedAmount,2899);
  assert.deepEqual(charged.body.formData.productPrice,['999.00','1900.00']);
});
