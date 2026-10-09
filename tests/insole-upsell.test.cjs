const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const offer = require('../api/insole-offer');
const cart = require('../assets/insole-upsell');
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
afterEach(() => { global.fetch = originalFetch; process.env = { ...originalEnv }; });
const product = { uid: cart.UID, title: 'Змінні устілки ULTERA', price: 249, family: 'Insole', photo: 'https://example.com/insole.png' };
function response() {
  return { code: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; }, end() { return this; } };
}
function setup() { process.env.SUPABASE_URL='https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-key'; }
test('offers shoe sizes only; excludes empty cart, accessories, slippers and barefoot', () => {
  assert.deepEqual(cart.eligibleSizes([]), []);
  assert.deepEqual(cart.eligibleSizes([
    {uid:'a',family:'Hunk3',size:'42 - 28см',qty:1},
    {uid:'b',family:'Aganta',size:'42',qty:2},
    {uid:'c',family:'Hunk',size:'40 - 26см'},
    {uid:'d',family:'SHAPE',size:'41'},
    {uid:'e',family:'BRFT',size:'41'},
    {uid:'f',family:'Tees',size:'L'},
    {uid:cart.UID,family:'Insole',size:'43'},
    {uid:'g',family:'Hunk',size:'44',qty:-1}
  ]), ['42','40']);
  assert.equal(cart.sizeKey('42 - 28см'),'42');
  assert.equal(cart.sizeKey('42.5'),'42');
  assert.equal(cart.sizeKey(''), '');
});
test('explicit add creates a normal separate, non-seasonal product and detects duplicates', () => {
  const item = cart.makeItem(product,'42');
  assert.equal(item.price,249); assert.equal(item.uid,cart.UID);
  assert.equal(item.seasonId,null); assert.equal(item.season,null);
  assert.equal(item.promoSecond,undefined);
  assert.equal(cart.alreadyAdded([item],'42'),true);
  assert.equal(cart.alreadyAdded([item],'40'),false);
  assert.equal(cart.alreadyAdded([],'42'),false);
});
test('offer endpoint selects one accessory and exposes only public fields', async () => {
  setup();
  global.fetch=async (url, options) => {
    assert.equal(url.searchParams.get('uid'),'eq.'+cart.UID);
    assert.equal(url.searchParams.get('family'),'eq.Insole');
    assert.equal(url.searchParams.get('select'),'uid,title,family,price,photo');
    assert.equal(options.headers.apikey,'test-only-key');
    return {ok:true,json:async()=>[{...product,price:'249',cost:50,secret:'must-not-leak'}]};
  };
  const res=response(); await offer({method:'GET'},res);
  assert.equal(res.code,200); assert.deepEqual(res.body.product,product);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});
test('offer fails closed for missing config and unsupported methods', async () => {
  global.fetch=async()=>{throw Error('must not request');};
  let res=response(); await offer({method:'POST'},res); assert.equal(res.code,405);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  res=response(); await offer({method:'GET'},res); assert.equal(res.code,503);
});
test('unavailable or invalid product is never offered at a fallback price', async () => {
  setup();
  for (const rows of [[],[{...product,price:0}],[{...product,price:'bad'}],[{...product,uid:'wrong'}]]) {
    global.fetch=async()=>({ok:true,json:async()=>rows});
    const res=response(); await offer({method:'GET'},res);
    assert.equal(res.body.product,null);
  }
  global.fetch=async()=>({ok:false});
  const res=response(); await offer({method:'GET'},res); assert.equal(res.code,503);
});
test('all executable inline scripts remain syntactically valid', () => {
  const html=readFileSync(require.resolve('../index.html'),'utf8');
  let count=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type=["'](?:application\/json|application\/ld\+json)["']/i.test(match[1]) || !match[2].trim()) continue;
    new vm.Script(match[2]); count++;
  }
  assert.ok(count>10);
  assert.equal((html.match(/id="cdInsoleUpsell"/g)||[]).length,1);
});
test('order handler sends the insole as a separate priced CRM line (mocked services only)', async () => {
  setup(); process.env.KEYCRM_TOKEN='test-only-token'; delete process.env.TURNSTILE_SECRET;
  delete process.env.FB_CAPI_TOKEN;
  let crmPayload;
  const items=[{uid:'809858137952',title:'Hunk3 All Black',size:'42',price:3990,qty:1,family:'Hunk3',seasonId:'autumn'}, {...cart.makeItem(product,'42'),qty:1}];
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.endsWith('/rpc/check_and_increment_rate_limit'))return{ok:true,json:async()=>({allowed:true})};
    if(target.endsWith('/rpc/compute_order_total')){
      const input=JSON.parse(options.body).p_items;
      assert.equal(input[1].uid,cart.UID); assert.equal(input[1].season_id,null);
      return{ok:true,json:async()=>({ok:true,total:4239,breakdown:items.map(it=>({uid:it.uid,qty:it.qty,unit_price:it.price,promo_pct:0,line_total:it.price}))})};
    }
    if(target.includes('/rest/v1/ulhome_orders'))return{ok:true,json:async()=>[{id:'local-test',number:'local-test'}]};
    if(target.endsWith('/rpc/ulhome_sale_stock_decrement'))return{ok:true,json:async()=>true};
    if(target==='https://openapi.keycrm.app/v1/order'){
      crmPayload=JSON.parse(options.body);return{ok:true,status:201,json:async()=>({id:-1}),text:async()=>JSON.stringify({id:-1})};
    }
    throw Error('Unexpected request: '+target);
  };
  const res=response();
  await require('../api/order')({method:'POST',headers:{origin:'https://ultera.in.ua'},body:{num:'QA-LOCAL-INSOLE',fio:'QA Local Test',phone:'+380000000000',items,total:4239,payment:'np',city:'Test',wh:'Test'}},res);
  assert.equal(res.code,200,JSON.stringify(res.body));
  assert.equal(crmPayload.products.length,2);
  assert.equal(crmPayload.products[1].sku,cart.UID);
  assert.equal(crmPayload.products[1].price,249);
  assert.match(crmPayload.products[1].name,/р\.42/);
  assert.equal(crmPayload.products.reduce((n,x)=>n+x.price*x.quantity,0),4239);
});
