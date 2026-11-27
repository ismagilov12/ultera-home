'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {makeCard, feedXml, sizeLabel} = require('../lib/black-friday-meta.cjs');

const listing = {
  uid:'bf26-test', title:'Чорні <кеди>', color:'Чорний & білий', available:true,
  photo:'/photos/black-friday/kedy.webp', season:'Весна-Осінь', price:1990, oldPrice:2990,
  variants:[{size:'40',available:true},{size:'41',available:false},{size:'42',available:true}]
};

test('one ad card keeps the shop ID and only shows purchasable sizes', () => {
  const card = makeCard(listing);
  assert.equal(card.uid, listing.uid);
  assert.equal(card.sizeText, '40, 42');
  assert.equal(card.season, 'Весна / осінь');
  assert.equal(new URL(card.link).searchParams.get('pair'), listing.uid);
  assert.equal(sizeLabel(['40','41','42','44','45']), '40–42, 44, 45');
  assert.match(feedXml([card]), /<g:sale_price>1990.00 UAH<\/g:sale_price>/);
  assert.match(feedXml([card]), /<g:price>2990.00 UAH<\/g:price>/);
  assert.match(feedXml([card]), /&lt;кеди&gt;/);
});

test('price, size, season and photo changes invalidate the ad image URL', () => {
  const original = makeCard(listing).image;
  for (const change of [{price:1790}, {variants:[{size:'40',available:true}]},
    {season:'Зима'}, {photo:'/photos/new.webp'}]) {
    assert.notEqual(makeCard({...listing, ...change}).image, original);
  }
});

test('missing seasons and sold inventory do not enter the public feed', () => {
  const unknown = makeCard({...listing, season:null});
  assert.doesNotMatch(feedXml([unknown]), /<item>/);
  assert.equal(makeCard({...listing, available:false}), null);
  assert.equal(makeCard({...listing, variants:[{size:'42',available:false}]}), null);
  assert.equal(makeCard({...listing, photo:'https://outside.example/picture.jpg'}), null);
});

test('season fallbacks require a documented version in the known factory batches', () => {
  const clearance = {...listing, uid:'bf26-n25-shoes', article:'ЮА 10', season:null};
  assert.equal(makeCard({...clearance, color:'Аква · сітка'}).season, 'Весна / літо');
  assert.equal(makeCard({...clearance, color:'Бордові · Cordura'}).season, 'Осінь');
  assert.equal(makeCard({...clearance, color:'Чорна термо Cordura'}).season, '');
  assert.equal(makeCard({...clearance, color:'Аква · біла підошва'}).season, '');
  assert.equal(makeCard({...clearance, season:'Зима', color:'Cordura'}).season, 'Зима');
});
