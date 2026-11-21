const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const compose = require('../build-black-friday.cjs');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const shop = read('index.html');
const campaign = read('templates/black-friday.html');
const page = compose(shop, campaign);

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
