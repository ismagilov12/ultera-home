const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const compose = require('../lib/black-friday-page.cjs');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const shop = read('index.html');
const campaign = read('templates/black-friday.html');
const page = compose(shop, campaign);

test('the landing starts with the campaign banner and both sale links lead to the catalogue below', () => {
  const main = page.indexOf('<main>', page.indexOf('<template shadowrootmode="open">'));
  const banner = page.indexOf('<section class="campaign"');
  const catalogue = page.indexOf('<slot name="pairs-anchor">');
  assert.ok(main >= 0 && page.indexOf('<section', main) === banner && banner < catalogue);
  assert.ok(catalogue < page.indexOf('<div class="grid" id="products">'));
  assert.match(page.slice(banner, catalogue), /href="#pairs">Обрати пару/);
  assert.match(page.slice(catalogue, page.indexOf('id="collection-title"')), /<slot name="last-pairs-anchor">/);
});

test('clearance precedes the unchanged main collection and the native checkout', () => {
  const collection = shop.slice(shop.indexOf('<!-- NEW COLLECTION -->') + '<!-- NEW COLLECTION -->'.length, shop.indexOf('<!-- SALE OSTATKI'));
  assert.ok(page.includes('<div id="catalog" slot="catalog">' + collection + '</div>'));
  assert.ok(page.indexOf('id="products"') < page.indexOf('id="collection"'));
  assert.ok(page.indexOf('id="collection"') < page.indexOf('id="cartDrawer"'));
  assert.equal(page.slice(page.indexOf('<!-- CART DRAWER -->')), shop.slice(shop.indexOf('<!-- CART DRAWER -->')));
  assert.equal(page.match(/id="featuredWrap"/g).length, 1);
});
test('the sale has its own share metadata and uses the shop tracking and fonts once', () => {
  assert.match(page, /<title>Чорна п’ятниця/);
  assert.match(page, /rel="canonical" href="https:\/\/ultera.in.ua\/black-friday"/);
  for (const expr of [/<title>/gi, /<meta name="viewport"/gi, /<meta name="description"/gi, /<meta charset=/gi, /src="\/assets\/customer-tracking\.js/g]) {
    assert.equal(page.match(expr).length, 1);
  }
  assert.ok(page.indexOf('<meta charset=') < 1024);
  assert.doesNotMatch(page, /rel="preload" as="image"[^>]*banners\/home-/);
  assert.doesNotMatch(page, /\/assets\/regular-catalog|id="regular-grid"/);
});
test('new warehouse photos have separate studio and pair views with sizes, independent of orderable stock', () => {
  const photos = require('../lib/black-friday-new-photos.json');
  const start = page.indexOf('<slot name="new-pairs-anchor">');
  const end = page.indexOf('<section id="sold-section"');
  assert.ok(page.indexOf('id="products"') < start && start < end);
  const gallery = page.slice(start, end);
  assert.equal(photos.length, 46);
  assert.equal(new Set(photos.map(photo=>photo.id)).size, photos.length);
  assert.equal((gallery.match(/<a class="new-photo-link"/g) || []).length, photos.length);
  assert.match(gallery, /EU 40 · 26 см/);
  assert.doesNotMatch(gallery, /data-buy|class="buy"|\bundefined\b/);
  for (const photo of photos) {
    assert.ok(photo.sizes.length);
    for (const subdir of ['', 'pairs/']) {
      const file = '/photos/black-friday/nov23/' + subdir + photo.id + '.webp';
      assert.ok(gallery.includes(file));
      const bytes = fs.readFileSync(path.join(__dirname, '..', file.slice(1)));
      assert.equal(bytes.toString('ascii',8,12),'WEBP');
    }
  }
});
test('both campaign URLs serve the shared page and HEAD does not send a body', () => {
  const handler = require('../api/black-friday-page');
  const config = require('../vercel.json');
  for (const source of ['/black-friday','/black-friday.html']) {
    assert.ok(config.rewrites.some(r => r.source === source && r.destination === '/api/black-friday-page'));
  }
  const res = {headers:{}, setHeader(k,v){ this.headers[k]=v; }, status(n){ this.code=n; return this; }, end(v){this.body=v;}};
  handler({method:'GET'}, res);
  assert.equal(res.body, page);
  assert.match(res.headers['Content-Type'], /text\/html/);
  handler({method:'HEAD'}, res);
  assert.equal(res.code, 200);
  assert.equal(res.body, undefined);
  handler({method:'POST'}, res);
  assert.equal(res.code, 405);
});
