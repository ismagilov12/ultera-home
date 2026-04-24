// api/wayforpay.js
// SECURITY v4 (2026-04-22):
//   - [v4] promoCode hardcoded table: SALE1 → -5% pro-rata on card path; cod unchanged
// SECURITY v3 (earlier):
//   - CORS whitelist (ultera.in.ua + *.vercel.app)
//   - Rate limit 30 req/min по IP (Supabase RPC)
//   - СЕРВЕРНЫЙ пересчёт amount из ulhome_products
//   - Фронт присылает items: [{uid, qty}]; legacy products поддерживается через title-mapping
//   - formHtml для backwards-compat
//   - [v3] paymentMode === 'cod' → передплата фіксованої суми з env COD_PREPAYMENT_AMOUNT
//          одна позиція "Передплата за замовлення ULT-XXXX", решту клієнт платить наложкою Нової Пошти
//          sanity: prepayment <= authoritativeTotal (щоб на акційні дешеві товари не брати більше)

const crypto = require('crypto');

// [v4] Hardcoded promo codes — keep in sync with api/order.js
const PROMOS = { 'SALE1': 5, 'ULTERA10': 10 };

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

async function checkRateLimit(ip, endpoint, limit) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { allowed: true, skipped: true };
  try {
    const r = await fetch(supabaseUrl + '/rest/v1/rpc/check_and_increment_rate_limit', {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_ip: ip, p_endpoint: endpoint, p_limit: limit })
    });
    if (!r.ok) return { allowed: true, skipped: true };
    return await r.json();
  } catch (e) { return { allowed: true, skipped: true }; }
}

async function computeAuthoritativeTotal(items) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { ok: false, error: 'Supabase not configured on server' };
  const r = await fetch(supabaseUrl + '/rest/v1/rpc/compute_order_total', {
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
    const q = encodeURIComponent('(' + uids.map(u => '"' + u + '"').join(',') + ')');
    const r = await fetch(supabaseUrl + '/rest/v1/ulhome_products?uid=in.' + q + '&select=uid,title,color_name', {
      headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey }
    });
    if (!r.ok) return {};
    const rows = await r.json();
    const byUid = {};
    for (const row of rows) {
      const name = [row.title, row.color_name].filter(Boolean).join(' / ');
      byUid[row.uid] = name || row.title || row.uid;
    }
    return byUid;
  } catch (e) { return {}; }
}

// Legacy fallback: если фронт прислал только products без uid — мапим по title.
async function deriveItemsFromLegacyProducts(products) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const r = await fetch(supabaseUrl + '/rest/v1/ulhome_products?select=uid,title,color_name&published=eq.true', {
      headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey }
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const items = [];
    for (const p of products) {
      const name = String(p.name || '').toLowerCase().trim();
      let uid = null;
      for (const row of rows) {
        const t = String(row.title || '').toLowerCase().trim();
        if (t && name && (t === name || t.includes(name) || name.includes(t))) { uid = row.uid; break; }
      }
      if (!uid) return null;
      items.push({ uid, qty: parseInt(p.count || 1, 10) });
    }
    return items;
  } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const merchantAccount = process.env.WAYFORPAY_MERCHANT;
  const secretKey = process.env.WAYFORPAY_SECRET;
  const merchantDomainName = process.env.WAYFORPAY_DOMAIN || 'ultera.in.ua';
  if (!merchantAccount || !secretKey) return res.status(500).json({ error: 'Payment system not configured' });

  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, 'wayforpay', 30);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ error: 'Too many requests', retry_after: rl.retry_after });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  body = body || {};

  const { orderReference, items, products, clientFirstName, clientLastName, clientEmail, clientPhone } = body;
  const paymentMode = String(body.paymentMode || '').toLowerCase();
  const isCOD = paymentMode === 'cod';

  if (!orderReference || typeof orderReference !== 'string') return res.status(400).json({ error: 'orderReference is required' });

  let resolvedItems = null;
  if (Array.isArray(items) && items.length > 0) {
    resolvedItems = items.map(it => ({ uid: String(it.uid || ''), qty: Math.max(parseInt(it.qty || 1, 10), 1) }));
  } else if (Array.isArray(products) && products.length > 0) {
    resolvedItems = await deriveItemsFromLegacyProducts(products);
    if (!resolvedItems) return res.status(400).json({ error: 'Legacy products could not be mapped to SKUs. Update frontend to send items: [{uid, qty}].' });
  } else {
    return res.status(400).json({ error: 'items or products array is required' });
  }

  const priceResult = await computeAuthoritativeTotal(resolvedItems);
  if (!priceResult.ok) return res.status(400).json({ error: priceResult.error || 'Price calculation failed', missing: priceResult.missing || null });
  const authoritativeAmount = Number(priceResult.total);
  if (!(authoritativeAmount > 0)) return res.status(400).json({ error: 'Computed amount is not positive' });

  // [v3] COD branch: single "Prepayment" line item with fixed server-side amount.
  // Keeps WayForPay signature valid (amount === sum(productPrice[i] * productCount[i])).
  let amountStr, productName, productCount, productPrice;
  if (isCOD) {
    const codPrepayment = Number(process.env.COD_PREPAYMENT_AMOUNT || 500);
    if (!(codPrepayment > 0)) return res.status(500).json({ error: 'COD prepayment misconfigured' });
    if (codPrepayment > authoritativeAmount) {
      return res.status(400).json({
        error: 'Prepayment exceeds order total',
        detail: { prepayment: codPrepayment, total: authoritativeAmount }
      });
    }
    amountStr      = codPrepayment.toFixed(2);
    productName    = ['Передплата за замовлення ' + orderReference];
    productCount   = ['1'];
    productPrice   = [codPrepayment.toFixed(2)];
  } else {
    // [v4] Promo on card path (pro-rata on unit_price so amount = sum(price*qty)).
    const promoCodeRaw = String(body.promoCode || '').toUpperCase().trim();
    const promoPct = (promoCodeRaw && PROMOS[promoCodeRaw]) || 0;
    const uids = resolvedItems.map(it => String(it.uid || ''));
    const names = await getProductNames(uids);
    productName  = [];
    productCount = [];
    productPrice = [];
    for (const line of priceResult.breakdown) {
      productName.push(names[line.uid] || line.uid);
      productCount.push(String(line.qty));
      let unit = Number(line.unit_price);
      if (promoPct > 0) unit = Math.round(unit * (100 - promoPct)) / 100;
      productPrice.push(unit.toFixed(2));
    }
    // Recompute amount from discounted productPrice so signature matches
    let discountedTotal = 0;
    priceResult.breakdown.forEach((line, i) => {
      discountedTotal += Number(productPrice[i]) * Number(productCount[i]);
    });
    amountStr = discountedTotal.toFixed(2);
  }

  const orderDate = Math.floor(Date.now() / 1000);
  const currency = 'UAH';

  const signatureFields = [
    merchantAccount, merchantDomainName, orderReference, String(orderDate), amountStr, currency,
    ...productName, ...productCount, ...productPrice
  ];
  const merchantSignature = crypto.createHmac('md5', secretKey).update(signatureFields.join(';'), 'utf8').digest('hex');

  const base = 'https://' + merchantDomainName;
  const returnUrl = base + '/?paid=1&order=' + encodeURIComponent(orderReference);
  const serviceUrl = base + '/api/wayforpay-callback';

  const formData = {
    merchantAccount, merchantAuthType: 'SimpleSignature', merchantDomainName, merchantSignature,
    orderReference, orderDate: String(orderDate), amount: amountStr, currency,
    productName, productCount, productPrice,
    clientFirstName: clientFirstName || '', clientLastName: clientLastName || '',
    clientEmail: clientEmail || '', clientPhone: clientPhone || '',
    returnUrl, serviceUrl, language: 'UA'
  };

  const formHtml = buildAutoSubmitForm(formData);
  return res.status(200).json({
    ok: true,
    paymentUrl: 'https://secure.wayforpay.com/pay',
    formData, formHtml,
    authoritativeAmount,
    chargedAmount: Number(amountStr),
    mode: isCOD ? 'cod-prepayment' : 'full',
    breakdown: priceResult.breakdown
  });
};

function buildAutoSubmitForm(data) {
  const inputs = [];
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      for (const v of val) inputs.push('<input type="hidden" name="' + esc(key) + '[]" value="' + esc(v) + '">');
    } else {
      inputs.push('<input type="hidden" name="' + esc(key) + '" value="' + esc(val) + '">');
    }
  }
  return '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><title>Payment redirect</title><style>body{font-family:-apple-system,Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0c0c0c;color:#fff}.box{text-align:center;padding:40px}.spinner{width:40px;height:40px;border:3px solid #333;border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spinner"></div><div>Redirecting to WayForPay...</div></div><form id="wfp" method="POST" action="https://secure.wayforpay.com/pay" accept-charset="utf-8">' + inputs.join('') + '</form><script>document.getElementById("wfp").submit();</script></body></html>';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
