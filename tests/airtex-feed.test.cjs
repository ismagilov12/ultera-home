const test = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../api/feed');
const rules = require('../assets/storefront-catalog-rules');

test('winter feed uses the public storefront, available sizes and winter prices without replacing regular item IDs', async t => {
  t.mock.method(globalThis, 'fetch', async raw => {
    const url = new URL(raw);
    const product = {
      id:1, uid:'454860479882', family:'Aganta', price:3590, sizes:[{price_old:4490}],
      color_name:'Чорний нубук', photo:'/old.jpg', published:true, feed_enabled:true,
      size_list:[{eu:'40',qty:4},{eu:'41',qty:0}]
    };
    if (url.pathname.endsWith('/ulhome_family_order')) return Response.json([{family:'Hunk3',hidden:true}]);
    if (url.pathname.endsWith('/ulhome_product_media')) return Response.json([]);
    assert.equal(url.searchParams.get('published'),'eq.true');
    assert.equal(url.searchParams.get('feed_enabled'),'eq.true');
    return Response.json([product, {...product,uid:'hidden',family:'Hunk3'}, {...product,uid:'retired',family:'Hunk'},
      {...product,uid:'high',family:'Thermo'}, {...product,uid:'empty',size_list:[{eu:'40',qty:0}]}]);
  });
  const before = {};
  for (const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
    before[name] = process.env[name];
    process.env[name] = name === 'SUPABASE_URL' ? 'https://catalog.test' : 'fixture';
    t.after(() => before[name] === undefined ? delete process.env[name] : process.env[name] = before[name]);
  }
  async function xml(query) {
    const res = {setHeader(){}, end(body){ this.body = body; }};
    await feed({query},res);
    assert.equal(res.statusCode,200);
    return res.body;
  }
  const winter = await xml({variant:'airtex'});
  assert.equal((winter.match(/<item>/g)||[]).length,1);
  assert.match(winter, /<g:id>airtex-winter-454860479882<\/g:id>/);
  assert.match(winter, /<g:price>5390.00 UAH<\/g:price>/);
  assert.match(winter, /<g:sale_price>5190.00 UAH<\/g:sale_price>/);
  assert.match(winter, /&amp;season=winter<\/g:link>/);
  assert.match(winter, /<g:size>40<\/g:size>/);
  assert.ok(winter.includes('https://ultera.in.ua' + rules.nubuck.photo));
  assert.ok(winter.includes('<g:custom_label_0>airtex-winter</g:custom_label_0>'));
  const regular = await xml({});
  assert.ok(regular.includes('<g:id>454860479882</g:id>'));
  assert.ok(!regular.includes('airtex-winter-'));
  assert.equal(rules.metaProductId({uid:'454860479882',family:'Aganta',seasonId:'winter'}),'airtex-winter-454860479882');
  assert.equal(rules.metaProductId({uid:'high',family:'Thermo',seasonId:'winter'}),'high');
});
