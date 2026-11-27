'use strict';

const {createHash} = require('node:crypto');
const SITE = 'https://ultera.in.ua';
// Change this when a visual change must invalidate Meta's cached photographs.
const STYLE_VERSION = 'bf-2026-1';
const money = new Intl.NumberFormat('uk-UA', {maximumFractionDigits: 2});

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function productPhoto(value) {
  if (typeof value !== 'string' || !value) return null;
  let url;
  try { url = new URL(value, SITE); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (['ultera.in.ua', 'ultera-home.vercel.app'].includes(url.hostname) &&
      /^\/(?:photos|assets)\//.test(url.pathname)) {
    url.hostname = 'ultera.in.ua';
    return url.href;
  }
  if (url.hostname === 'fsihlzzjewhxpogvjapu.supabase.co' &&
      url.pathname.startsWith('/storage/v1/object/public/ulhome-media/')) return url.href;
  return null;
}

function sizeLabel(sizes) {
  // A range is only valid if every intermediate size is available.
  const parts = [];
  for (let i = 0; i < sizes.length; i++) {
    let end = i;
    while (end + 1 < sizes.length && Number(sizes[end + 1]) === Number(sizes[end]) + 1) end++;
    if (end - i >= 2) parts.push(sizes[i] + '–' + sizes[end]);
    else parts.push(...sizes.slice(i, end + 1));
    i = end;
  }
  return parts.join(', ');
}

// These warehouse batches use the factory articles from the regular catalogue.
// Keep its material-specific versions separate; the same colour can exist in summer and winter.
function catalogueSeason(item) {
  const explicit = (item.season || '').trim();
  if (explicit) return explicit;
  if (!/^bf26-n(?:23|24|25)-/.test(item.uid)) return '';
  const color = item.color || '';
  if (/термо|утепл|зимов/i.test(color)) return '';

  // Hunk, Hunk2, Aganta and Hunk3 describe breathable mesh as spring/summer.
  // Their regular Cordura editions, including Hunk BRFT, carry the autumn label.
  if (/^ЮА (?:1|2|10|11)$/.test(item.article)) {
    const mesh = /сітка/i.test(color);
    const cordura = /cordura/i.test(color);
    if (mesh !== cordura) return mesh ? 'Весна / літо' : 'Осінь';
  }
  if (item.article === 'Кед 02' && /шкіра/i.test(color)) return 'Весна / осінь';
  if (item.article === 'ЮА 20' && /мюлі/i.test(color)) return 'Літо';
  // Matches to Lite СП3 catalogue rows 567516763104 and 582167412397 respectively.
  if (item.uid === 'bf26-n25-sp3-black-leather-white-cupsole') return 'Весна / осінь';
  if (item.uid === 'bf26-n24-sp3-white-leather') return 'Весна / літо';
  return '';
}

function makeCard(item) {
  if (!item?.available || !/^(?:bf26-|bfoffer-)[a-z0-9-]+$/.test(item.uid)) return null;
  const photo = productPhoto(item.photo);
  const price = Number(item.price);
  const variants = Array.isArray(item.variants) ? item.variants : [item];
  const sizes = [...new Set(variants.filter(entry => entry.available)
    .map(entry => String(entry.size)).filter(size => /^\d{2}(?:\.5)?$/.test(size)))]
    .sort((a, b) => Number(a) - Number(b));
  if (!photo || !Number.isFinite(price) || price <= 0 || !sizes.length) return null;
  const originalSeason = catalogueSeason(item);
  const season = /^весна\s*[-–—/]\s*(осінь|літо)$/i.test(originalSeason)
    ? 'Весна / ' + originalSeason.split(/[-–—/]/).pop().trim().toLowerCase()
    : originalSeason;
  const name = String(item.title || item.article || '').trim();
  const color = String(item.color || '').trim();
  const condition = String(item.condition || '').trim();
  const oldPrice = Number(item.oldPrice) > price ? Number(item.oldPrice) : null;
  const card = {uid:item.uid, name, color, condition, season, photo, price, oldPrice, sizes};
  const hash = createHash('sha256').update(JSON.stringify([STYLE_VERSION, card])).digest('hex').slice(0, 16);
  card.sizeText = sizeLabel(sizes);
  card.priceText = money.format(price).replace(/[\u00a0\u202f]/g, ' ') + ' ₴';
  card.image = SITE + '/photos/bf-catalog/' + item.uid + '/' + hash + '.jpg';
  card.version = hash;
  card.link = SITE + '/black-friday?pair=' + encodeURIComponent(item.uid) +
    '&utm_source=facebook&utm_medium=paid_social&utm_campaign=black_friday';
  return card;
}

function feedXml(cards) {
  const tag = (key, value) => '      <g:' + key + '>' + escapeXml(value) + '</g:' + key + '>';
  const items = cards.filter(card => card.season).map(card => {
    const title = ['ULTERA ' + card.name, card.color].filter(Boolean).join(' · ');
    const description = [title + '.', 'Сезон — ' + card.season + '.',
      'Доступні розміри EU — ' + card.sizes.join(', ') + '.', card.condition].filter(Boolean).join(' ');
    const fields = {
      id:card.uid, title, description, link:card.link, image_link:card.image, availability:'in stock',
      condition:'new', price:(card.oldPrice || card.price).toFixed(2) + ' UAH',
      ...(card.oldPrice ? {sale_price:card.price.toFixed(2) + ' UAH'} : {}),
      brand:'ULTERA', google_product_category:'187', size:card.sizes.join(', '), size_system:'EU',
      ...(card.color ? {color:card.color} : {}), custom_label_0:'black-friday', custom_label_1:card.season
    };
    return '    <item>\n' + Object.entries(fields).map(([k, v]) => tag(k, v)).join('\n') + '\n    </item>';
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>',
    '<title>ULTERA · Чорна п’ятниця</title>', '<link>' + SITE + '/black-friday</link>',
    '<description>Взуття ULTERA у наявності до Чорної п’ятниці.</description>',
    ...items, '</channel></rss>'].join('\n');
}

module.exports = {SITE, escapeXml, makeCard, feedXml, sizeLabel};
