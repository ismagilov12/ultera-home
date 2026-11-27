'use strict';

const {SITE, makeCard, feedXml} = require('../lib/black-friday-meta.cjs');

// Feed and image requests arriving together can share the same storefront inventory.
let pending;
let cached;
let validUntil = 0;
async function currentCards() {
  if (cached && Date.now() < validUntil) return cached;
  if (!pending) pending = (async () => {
    const response = await fetch(SITE + '/api/black-friday', {signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Catalogue unavailable');
    const {items} = await response.json();
    if (!Array.isArray(items)) throw new Error('Invalid catalogue');
    const cards = items.map(makeCard).filter(card => card && card.season);
    cached = cards;
    validUntil = Date.now() + 15_000;
    return cards;
  })().finally(() => { pending = null; });
  return pending;
}

module.exports = async function blackFridayMeta(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  try {
    const cards = await currentCards();
    const {uid, v} = req.query || {};
    if (uid === undefined) {
      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      res.setHeader('X-Feed-Items', String(cards.length));
      return res.status(200).end(req.method === 'HEAD' ? undefined : feedXml(cards));
    }
    const card = cards.find(candidate => candidate.uid === uid);
    if (!card) return res.status(404).end();
    if (v !== card.version) {
      res.setHeader('Location', card.image);
      return res.status(307).end();
    }
    res.setHeader('Content-Type', 'image/jpeg');
    if (req.method === 'HEAD') return res.status(200).end();
    const response = await fetch(card.photo, {redirect:'error', signal:AbortSignal.timeout(10000)});
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) {
      throw new Error('Product photograph unavailable');
    }
    const {renderCard} = require('../lib/black-friday-card.cjs');
    const bytes = await renderCard(card, Buffer.from(await response.arrayBuffer()));
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.status(200).end(bytes);
  } catch (error) {
    console.error('[black-friday-meta]', error.message);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(503).end('Не вдалося завантажити каталог.');
  }
};
