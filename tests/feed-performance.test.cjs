'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const stats = require('../assets/feed-performance.js');

test('no conversion for an empty denominator', () => {
  assert.equal(stats.ratio(0,0),null);
  assert.equal(stats.normalizeRow({}).cr,null);
});
test('conversion uses sessions rather than number of orders', () => {
  const row=stats.normalizeRow({entry_sessions:1,cart_sessions:1,converted_sessions:1,matched_orders:3});
  assert.equal(row.cr,100);
  assert.equal(row.matched_orders,3);
});
test('bad ratios are rejected, not hidden with a 100% cap', () => {
  assert.throws(() => stats.ratio(33,10));
  assert.throws(() => stats.normalizeRow({entry_sessions:2,cart_sessions:1,converted_sessions:2}));
  assert.throws(() => stats.normalizeRow({entry_sessions:2,cart_sessions:3}));
  assert.throws(() => stats.normalizeRow({views:-1}));
});
test('totals are weighted by the session denominator', () => {
  const rows=[stats.normalizeRow({entry_sessions:100,cart_sessions:10,converted_sessions:5}),
    stats.normalizeRow({entry_sessions:10,cart_sessions:2,converted_sessions:1})];
  const sum=stats.totals(rows);
  assert.equal(sum.entry_sessions,110);
  assert.equal(sum.converted_sessions,6);
  assert.ok(Math.abs(sum.cr-6/110*100)<1e-10);
});
test('Kyiv calendar days do not use the viewers Bangkok clock', () => {
  const p=stats.periodBounds(7,new Date('2026-11-01T11:08:48Z'));
  assert.equal(p.from,'2026-10-25T22:00:00.000Z');
  assert.equal(p.to,'2026-11-01T11:08:48.000Z');
});
test('Kyiv daylight saving transition is handled on both sides', () => {
  assert.equal(stats.periodBounds(1,new Date('2026-10-25T12:00:00Z')).from,'2026-10-24T21:00:00.000Z');
  assert.equal(stats.periodBounds(1,new Date('2026-10-26T12:00:00Z')).from,'2026-10-25T22:00:00.000Z');
});
test('all supported periods use valid ordered bounds', () => {
  for(const days of [1,7,30,90]) {
    const p=stats.periodBounds(days,new Date('2026-11-01T00:30:00Z'));
    assert.ok(new Date(p.to)>new Date(p.from));
    assert.ok(new Date(p.to)-new Date(p.from)<93*86400000);
  }
  assert.throws(() => stats.periodBounds(0));
});
test('the admin loads the v2 asset before its main inline script', () => {
  const html=fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8');
  assert.ok(html.indexOf('/assets/feed-performance.js?v=20261101-v3')<html.indexOf('const SB_URL'));
  assert.ok(html.includes('window.ULTERA_FEED_STATS.init({rest})'));
  assert.ok(!html.includes("rest('rpc/ulhome_feed_link_stats',"));
  assert.ok(!html.includes("sum.link_orders/sum.clicks"));
  assert.ok(html.includes('feed-settings-panel'));
  const scripts=Array.from(html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi));
  for(const [index,match] of scripts.entries()) new vm.Script(match[1],{filename:'admin-inline-'+index});
});
test('sales, funnel, current status freshness and consent limitations are explicit', () => {
  const js=fs.readFileSync(path.join(__dirname,'../assets/feed-performance.js'),'utf8');
  assert.ok(js.includes('ulhome_feed_link_stats_v2'));
  assert.ok(js.includes('orders_without_cart'));
  assert.ok(js.includes('orders_without_entry'));
  assert.ok(js.includes('stale_crm_orders'));
  assert.ok(!js.includes('analytics_events'));
});
test('loading a new period clears the old payload and deduplicates visibility requests', () => {
  const js=fs.readFileSync(path.join(__dirname,'../assets/feed-performance.js'),'utf8');
  assert.ok(js.includes('fs.pendingKey === String(fs.days)'));
  assert.ok(js.includes('fs.pendingKey=String(days);fs.payload=null;fs.rows=[];fs.orphans=[];fs.loadedKey=\'\''));
  assert.ok(js.includes('if(request === fs.sequence)fs.pendingKey=null'));
});
