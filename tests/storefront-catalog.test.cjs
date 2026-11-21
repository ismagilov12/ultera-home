const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../api/storefront-catalog');

function upstream(t, products, families) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const query = new URL(url);
    let rows;
    if (query.pathname.endsWith('/ulhome_products')) {
      assert.equal(query.searchParams.get('published'), 'eq.true');
      rows = products;
    } else {
      assert.ok(query.pathname.endsWith('/ulhome_family_order'));
      if (families === null) return new Response(null, {status:503});
      rows = families;
    }
    const [start, end] = options.headers.Range.split('-').map(Number);
    return Response.json(rows.slice(start, end + 1));
  });
  for (const [key,value] of Object.entries({SUPABASE_URL:'https://store.invalid', SUPABASE_ANON_KEY:'public-fixture'})) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
async function request() {
  const res = {setHeader(){}, status(code){ this.code = code; return this; }, json(data){ this.body = data; }};
  await catalog({method:'GET'}, res);
  return res;
}
function product(family, uid) {
  return {family, uid, photo:'/test.webp', color_name:'Чорний', price:'3990', gender:'unisex'};
}
test('the campaign regular catalogue follows storefront grouping, prices, pictures and visibility', async t => {
  upstream(t, [
    product('SHAPE','solid'), product('SHAPE','340180708714'), product('Aganta','454860479882'),
    product('Hunk','550020260919'), product('Hunk','retired'), product('Aganta Thermo','retired-winter'),
    product('Aganta Thermo','550020260922'), product('SaleOstatki','ordinary-looking-uid'),
    product('SHAPE','bf26-pair'), product('Hidden','invisible'), product('Tees','tee')
  ], [
    {family:'Thermo',sort_order:1}, {family:'Aganta',sort_order:2}, {family:'Hunk',sort_order:3},
    {family:'SHAPE',sort_order:4}, {family:'Hidden',hidden:true}
  ]);
  const res = await request();
  assert.equal(res.code, 200);
  const result = res.body.families;
  assert.deepEqual(result.map(f => [f.name, f.variants.map(v => v.uid)]), [
    ['Aganta Thermo',['550020260922']], ['Aganta',['454860479882']], ['Hunk',['550020260919']], ['SHAPE',['340180708714','solid']]
  ]);
  assert.equal(result[1].variants[0].price, 4290);
  assert.equal(result[1].variants[0].photo, '/photos/aganta-black-nubuck-cordura.jpg');
  assert.equal(result[0].variants[0].gender, 'unisex');
});
test('later product pages are included and a failed visibility read never exposes hidden models', async t => {
  const products = Array.from({length:102}, (_, i) => product('regular', String(i)));
  await t.test('pagination', async t => {
    upstream(t, products, []);
    assert.equal((await request()).body.families[0].variants.length, 102);
  });
  await t.test('visibility unavailable', async t => {
    upstream(t, products, null);
    assert.equal((await request()).code, 503);
  });
});
