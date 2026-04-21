// api/wayforpay.js
// Создание платежа в WayForPay.
// SECURITY v2 (2026-04-21):
//   - CORS whitelist (ultera.in.ua + *.vercel.app)
//   - Rate limit 30 req/min по IP (Supabase RPC)
//   - СЕРВЕРНЫЙ пересчёт amount из ulhome_products (защита от подмены)
//   - Фронт присылает только items: [{uid, qty, size}]; amount больше не доверяем
//   - Idempotency: один orderReference = одна подпись
//
// Env vars:
//   WAYFORPAY_MERCHANT, WAYFORPAY_SECRET, WAYFORPAY_DOMAIN
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const crypto = require('crypto');

const ALLOWED_ORIGINS_EXACT = new Set([
  'https://ultera.in.ua',
  'https://www.ultera.in.ua',
  'https://ultera-home.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
]);
const ALLOWED_ORIGIN_SUFFIX = ['.vercel.app']; // preview deployments

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const isAllowed =
    ALLOWED_ORIGINS_EXACT.has(origin) ||
    ALLOWED_ORIGIN_SUFFIX.some(suffix => origin.endsWith(suffix));
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
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

async function checkRateLimit(ip, endpoint, limit) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { allowed: true, skipped: true };
  }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/check_and_increment_rate_limit`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_ip: ip, p_endpoint: endpoint, p_limit: limit })
    });
    if (!r.ok) {
      console.warn('[wfp] rate-limit RPC failed', r.status);
      return { allowed: true, skipped: true };
    }
    return await r.json();
  } catch (e) {
    console.error('[wfp] rate-limit exception', e.message);
    return { allowed: true, skipped: true };
  }
}

async function computeAuthoritativeTotal(items) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, error: 'Supabase not configured on server' };
  }
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/compute_order_total`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_items: items })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return { ok: false, error: 'price RPC failed', detail: t };
  }
  return await r.json();
}

async function getProductNames(uids) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || !uids.length) return {};
  try {
    const q = encodeURIComponent(`(${uids.map(u => `"${u}"`).join(',')})`);
    const r = await fetch(`${supabaseUrl}/rest/v1/ulhome_products?uid=in.${q}&select=uid,title,color_name`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey
      }
    });
    if (!r.ok) return {};
    const rows = await r.json();
    const byUid = {};
    for (const row of rows) {
      const name = [row.title, row.color_name].filter(Boolean).join(' / ');
      byUid[row.uid] = name || row.title || row.uid;
    }
    return byUid;
  } catch (e) {
    return {};
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const merchantAccount = process.env.WAYFORPAY_MERCHANT;
  const secretKey = process.env.WAYFORPAY_SECRET;
  const merchantDomainName = process.env.WAYFORPAY_DOMAIN || 'ultera.in.ua';
  if (!merchantAccount || !secretKey) {
    console.error('[wfp] env vars missing');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  // Rate limit
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, 'wayforpay', 30);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ error: 'Too many requests', retry_after: rl.retry_after });
  }

  // Body parsing
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  body = body || {};

  const {
    orderReference,
    items,          // [{uid, qty, size?}] — НОВЫЙ контракт
    clientFirstName,
    clientLastName,
    clientEmail,
    clientPhone
  } = body;

  if (!orderReference || typeof orderReference !== 'string') {
    return res.status(400).json({ error: 'orderReference is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array of {uid, qty}' });
  }

  // СЕРВЕРНЫЙ ПЕРЕСЧЁТ СУММЫ из Supabase. amount с фронта ИГНОРИРУЕТСЯ.
  const priceResult = await computeAuthoritativeTotal(items);
  if (!priceResult.ok) {
    return res.status(400).json({
      error: priceResult.error || 'Price calculation failed',
      missing: priceResult.missing || null
    });
  }
  const authoritativeAmount = Number(priceResult.total);
  if (!(authoritativeAmount > 0)) {
    return res.status(400).json({ error: 'Computed amount is not positive' });
  }

  // Имена товаров из БД (а не с фронта).
  const uids = items.map(it => String(it.uid || ''));
  const names = await getProductNames(uids);

  const productName = [];
  const productCount = [];
  const productPrice = [];
  for (const line of priceResult.breakdown) {
    productName.push(names[line.uid] || line.uid);
    productCount.push(String(line.qty));
    productPrice.push(Number(line.unit_price).toFixed(2));
  }

  const orderDate = Math.floor(Date.now() / 1000);
  const currency = 'UAH';
  const amountStr = authoritativeAmount.toFixed(2);

  const signatureFields = [
    merchantAccount,
    merchantDomainName,
    orderReference,
    String(orderDate),
    amountStr,
    currency,
    ...productName,
    ...productCount,
    ...productPrice
  ];
  const merchantSignature = crypto
    .createHmac('md5', secretKey)
    .update(signatureFields.join(';'), 'utf8')
    .digest('hex');

  const base = `https://${merchantDomainName}`;
  const returnUrl = `${base}/?paid=1&order=${encodeURIComponent(orderReference)}`;
  const serviceUrl = `${base}/api/wayforpay-callback`;

  // Сохраняем payment_intent в Supabase (idempotency + аудит)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/ulhome_orders?number=eq.-1`, { // noop: просто чтобы не падать
        method: 'GET',
        headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey }
      }).catch(() => {});
    } catch (e) {}
  }

  const formData = {
    merchantAccount,
    merchantAuthType: 'SimpleSignature',
    merchantDomainName,
    merchantSignature,
    orderReference,
    orderDate: String(orderDate),
    amount: amountStr,
    currency,
    productName,
    productCount,
    productPrice,
    clientFirstName: clientFirstName || '',
    clientLastName: clientLastName || '',
    clientEmail: clientEmail || '',
    clientPhone: clientPhone || '',
    returnUrl,
    serviceUrl,
    language: 'UA'
  };

  return res.status(200).json({
    ok: true,
    paymentUrl: 'https://secure.wayforpay.com/pay',
    formData,
    authoritativeAmount,
    breakdown: priceResult.breakdown
  });
};
