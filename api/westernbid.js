// api/westernbid.js — ULTERA international checkout (US/EU) via Western Bid.
// Builds a signed redirect-form for the WB gateway. Currency is env-driven
// (default EUR); server recomputes the authoritative UAH total via
// compute_order_total and converts to the target currency by a configurable FX
// rate. An order row is created in ulhome_orders (payment_method='westernbid',
// payment_status='pending'); the Supabase order number is embedded into the WB
// `invoice`, so the IPN callback can look the row up and stay idempotent with
// zero schema changes.
//
// Env vars:
//   WB_LOGIN                merchant login (public, goes into the form)
//   WB_SECRET               merchant secret (server only, used for md5 sign)
//   WB_ENDPOINT             gateway URL (default https://shop.westernbid.info)
//   WB_CURRENCY             currency_code sent to WB (default 'EUR')
//   WB_FX_UAH_PER_UNIT      UAH per 1 unit of WB_CURRENCY (e.g. 45 for EUR)
//   WB_RETURN_URL           success return (default https://ultera.in.ua/?paid=1)
//   WB_CANCEL_URL           cancel return  (default https://ultera.in.ua/?paid=0)
//   WB_NOTIFY_URL           IPN url (default https://ultera.in.ua/api/westernbid-callback)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TURNSTILE_SECRET        (optional)

const crypto = require('crypto');

const ALLOWED_ORIGINS_EXACT = new Set([
  'https://ultera.in.ua',
  'https://www.ultera.in.ua',
  'https://ultera-home.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
]);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const isAllowed = ALLOWED_ORIGINS_EXACT.has(origin) || origin.endsWith('.vercel.app');
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return isAllowed;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function checkRateLimit(ip, limit) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { allowed: true, skipped: true };
  try {
    const r = await fetch(url + '/rest/v1/rpc/check_and_increment_rate_limit', {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ip: ip, p_endpoint: 'westernbid', p_limit: limit })
    });
    if (!r.ok) return { allowed: true, skipped: true };
    return await r.json();
  } catch (e) { return { allowed: true, skipped: true }; }
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'captcha token missing' };
  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = await r.json();
    return { ok: !!data.success, errors: data['error-codes'] || [] };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function recomputeUah(items) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const payload = (items || []).map(function (it) {
      const explicitPct = Number(it.promo_pct || 0);
      const inferredPct = it.promoSecond ? 30 : 0;
      const pct = explicitPct > 0 ? explicitPct : inferredPct;
      return { uid: String(it.uid || ''), qty: parseInt(it.qty || 1, 10), promo_pct: Math.max(0, Math.min(90, pct)) };
    });
    const r = await fetch(url + '/rest/v1/rpc/compute_order_total', {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_items: payload })
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function saveOrder(order) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(url + '/rest/v1/ulhome_orders', {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(order)
    });
    if (!r.ok) { console.warn('[wb] supabase insert failed', r.status, await r.text().catch(function () { return ''; })); return null; }
    const rows = await r.json();
    return rows[0] || null;
  } catch (e) { console.error('[wb] supabase exception', e.message); return null; }
}

function md5(s) { return crypto.createHash('md5').update(String(s), 'utf8').digest('hex'); }

// Nova Global shipping zones (EUR per order). Keep in sync with the frontend.
const SHIP_Z1 = ['PL','SK','HU','RO','CZ','MD'];
const SHIP_Z2 = ['DE','AT','FR','IT','ES','NL','BE','LU','PT','IE','DK','SE','FI','GR','LT','LV','EE','SI','HR','BG','CH','NO'];
const SHIP_Z3 = ['GB'];
const SHIP_Z4 = ['US','CA'];
function shippingEur(country) {
  const c = String(country || '').toUpperCase();
  if (SHIP_Z1.indexOf(c) >= 0) return 9;
  if (SHIP_Z2.indexOf(c) >= 0) return 12;
  if (SHIP_Z3.indexOf(c) >= 0) return 14;
  if (SHIP_Z4.indexOf(c) >= 0) return 20;
  return 28;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || 'Customer', last: '-' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, 10);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ ok: false, error: 'Too many requests', retry_after: rl.retry_after });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); } }
  body = body || {};

  if (!body.fio || !body.phone) return res.status(400).json({ ok: false, error: 'Missing fio/phone' });
  if (!body.email) return res.status(400).json({ ok: false, error: 'Email required for international payment' });
  if (!Array.isArray(body.items) || body.items.length === 0) return res.status(400).json({ ok: false, error: 'Missing items' });
  if (!body.country || !body.city || !body.address1) return res.status(400).json({ ok: false, error: 'Missing shipping address (country/city/address)' });

  const captcha = await verifyTurnstile(body.captchaToken, ip);
  if (!captcha.ok) return res.status(403).json({ ok: false, error: 'Captcha failed', detail: captcha.errors || captcha.error });

  // Authoritative total in UAH via compute_order_total. Some catalog items
  // (clearance colors) aren't in that RPC; for those we fall back to the
  // client-sent DB price so the sale isn't blocked.
  const priced = await recomputeUah(body.items);
  const breakdown = (priced && priced.ok && Array.isArray(priced.breakdown)) ? priced.breakdown : null;
  let uahTotal;
  if (priced && priced.ok && Number(priced.total) > 0) {
    uahTotal = Number(priced.total);
  } else {
    uahTotal = (body.items || []).reduce(function (s, it) {
      return s + (parseFloat(it.price) || 0) * (parseInt(it.qty || 1, 10));
    }, 0);
  }
  if (!(uahTotal > 0)) return res.status(400).json({ ok: false, error: 'Invalid total' });

  // Currency conversion (env-driven; flip to USD without code changes).
  const currency = String(process.env.WB_CURRENCY || 'EUR').toUpperCase();
  const fx = Number(process.env.WB_FX_UAH_PER_UNIT || 0);
  if (!(fx > 0)) return res.status(500).json({ ok: false, error: 'FX rate not configured (WB_FX_UAH_PER_UNIT)' });
  const amountNum = Math.round((uahTotal / fx) * 100) / 100;
  const amount = amountNum.toFixed(2);
  // Shipping (Nova Global zone by destination country); WB charges amount + shipping.
  const shipEur = shippingEur(body.country);
  const totalEur = Math.round((amountNum + shipEur) * 100) / 100;

  const wbLogin = process.env.WB_LOGIN;
  const wbSecret = process.env.WB_SECRET;
  if (!wbLogin || !wbSecret) return res.status(500).json({ ok: false, error: 'WB credentials not configured' });

  // Persist order (canonical total stays in UAH; foreign amount noted).
  const orderRow = await saveOrder({
    customer_name: body.fio,
    customer_phone: body.phone,
    customer_email: body.email,
    delivery_type: 'intl',
    delivery_city: body.city,
    delivery_branch: [body.address1, body.zip, body.country].filter(Boolean).join(', '),
    payment_method: 'westernbid',
    payment_status: 'pending',
    items: body.items,
    total: uahTotal,
    status: 'new',
    notes: 'WB ' + currency + ' goods ' + amount + ' + ship ' + shipEur.toFixed(2) + ' = ' + totalEur.toFixed(2) + ' @ ' + fx + ' UAH/unit' + (body.comment ? ('\n' + body.comment) : ''),
    session_id:  (typeof body.session_id  === 'string' ? body.session_id  : '').slice(0, 200)  || null,
    referrer:    (typeof body.referrer    === 'string' ? body.referrer    : '').slice(0, 2000) || null,
    landing_url: (typeof body.landing_url === 'string' ? body.landing_url : '').slice(0, 2000) || null
  });

  // invoice encodes the order number → callback does an exact lookup + idempotency.
  const orderNumber = orderRow && (orderRow.number != null) ? String(orderRow.number) : ('T' + Date.now());
  const invoice = 'ULH-' + orderNumber + '-' + crypto.randomBytes(3).toString('hex');

  const wbHash = md5(wbLogin + wbSecret + amount + invoice);
  const nm = splitName(body.fio);
  const endpoint = process.env.WB_ENDPOINT || 'https://shop.westernbid.info';

  const fields = {
    charset: 'utf-8',
    wb_login: wbLogin,
    wb_hash: wbHash,
    invoice: invoice,
    amount: amount,
    currency_code: currency,
    item_name: 'ULTERA order ' + orderNumber,
    first_name: nm.first,
    last_name: nm.last,
    email: body.email,
    phone: String(body.phone),
    address1: String(body.address1),
    city: String(body.city),
    country: String(body.country),
    zip: String(body.zip || ''),
    state: String(body.state || ''),
    shipping: shipEur.toFixed(2),
    return: process.env.WB_RETURN_URL || 'https://ultera.in.ua/?paid=1',
    cancel_return: process.env.WB_CANCEL_URL || 'https://ultera.in.ua/?paid=0',
    notify_url: process.env.WB_NOTIFY_URL || 'https://ultera.in.ua/api/westernbid-callback'
  };

  // Payment gateway: default PayPal (which also accepts guest card payments).
  // Set WB_GATE=stripe.com to route through Stripe once WB support enables it.
  const gate = String(process.env.WB_GATE || '').trim();
  if (gate) fields.gate = gate;
  // Stripe requires a 7% Florida (US) sales tax for FL buyers (per WB docs).
  if (gate === 'stripe.com' && String(body.state || '').toUpperCase() === 'FL') {
    fields.sales_tax = (Math.round(amountNum * 0.07 * 100) / 100).toFixed(2);
  }

  // Per-line items. Per WB docs, item_name_x, item_number_x, quantity_x,
  // amount_x, url_x AND description_x are all required.
  (body.items || []).forEach(function (it, i) {
    const n = i + 1;
    const line = breakdown ? breakdown.find(function (b) { return b.uid === String(it.uid || ''); }) : null;
    const unitUah = line ? Number(line.unit_price) : (parseFloat(it.price) || 0);
    const unitCur = Math.round((unitUah / fx) * 100) / 100;
    const nm = (it.title || 'ULTERA item') + (it.color_name ? ' / ' + it.color_name : '') + (it.size ? ' / ' + it.size : '');
    fields['item_name_' + n] = nm;
    fields['item_number_' + n] = String(it.uid || '');
    fields['amount_' + n] = unitCur.toFixed(2);
    fields['quantity_' + n] = String(parseInt(it.qty || 1, 10));
    fields['url_' + n] = it.url || (it.uid ? ('https://ultera.in.ua/?p=' + encodeURIComponent(it.uid)) : 'https://ultera.in.ua');
    fields['description_' + n] = nm;
  });

  return res.status(200).json({
    ok: true,
    endpoint: endpoint,
    method: 'POST',
    fields: fields,
    invoice: invoice,
    amount: amount,
    currency: currency,
    shipping: shipEur.toFixed(2),
    total: totalEur.toFixed(2),
    order_number: orderNumber,
    uah_total: uahTotal
  });
};
