// api/order.js — proxy ultera-home frontend → KeyCRM
// SECURITY v7 (2026-04-23):
//   - [v7] DB-backed promo codes via ulhome_promo_codes table.
//          On final stage → ulhome_redeem_promo() (atomic +1 with max_uses guard).
//          On lead stage → ulhome_peek_promo() (no mutation).
//          Legacy hardcoded PROMOS still honored for SALE1 backward-compat.
// SECURITY v6 (2026-04-22):
//   - [v6] FIX: shipping_address_warehouse -> shipping_receive_point (actual KeyCRM v1 field).
//          shipping_address_city restored so it appears in the list column / filter.
//   - [v6] Debug: log(body.city, body.wh, items[].season) to Vercel Runtime Logs.
// SECURITY v5 (earlier):
//   - [v5] product name includes season suffix (' / Літо' or ' / Весна/Осінь')
// SECURITY v4 (earlier):
//   - [v4] promoCode hardcoded table: SALE1 → -5% off whole order
// SECURITY v3 (earlier):
//   - CORS whitelist (ultera.in.ua + *.vercel.app), Rate limit 10/min/IP, Turnstile
//
// Env vars:
//   KEYCRM_TOKEN, KEYCRM_SOURCE_ID, KEYCRM_PM_CARD, KEYCRM_PM_NP, KEYCRM_DS_NP
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TURNSTILE_SECRET (optional)

// Legacy hardcoded promo codes (server-side truth; extend with DB codes).
const LEGACY_PROMOS = { 'SALE1': 5 };

const ALLOWED_ORIGINS_EXACT = new Set([
  'https://ultera.in.ua',
  'https://www.ultera.in.ua',
  'https://ultera-home.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
]);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const isAllowed =
    ALLOWED_ORIGINS_EXACT.has(origin) ||
    origin.endsWith('.vercel.app');
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

async function checkRateLimit(ip, limit) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { allowed: true, skipped: true };
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/check_and_increment_rate_limit`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_ip: ip, p_endpoint: 'order', p_limit: limit })
    });
    if (!r.ok) return { allowed: true, skipped: true };
    return await r.json();
  } catch (e) {
    return { allowed: true, skipped: true };
  }
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
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form
    });
    const data = await r.json();
    return { ok: !!data.success, errors: data['error-codes'] || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function recomputePrices(items) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const payload = items.map(it => ({ uid: String(it.uid || ''), qty: parseInt(it.qty || 1, 10) }));
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/compute_order_total`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_items: payload })
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

// [v7] DB-backed promo resolver. If `redeem` is true → atomic ulhome_redeem_promo
// (increments uses_count, returns {discount_pct, remaining} or empty if maxed).
// Else peek (ulhome_peek_promo) — no mutation, returns same shape + active flag.
async function resolveDbPromo(code, redeem) {
  if (!code) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const rpc = redeem ? 'ulhome_redeem_promo' : 'ulhome_peek_promo';
    const r = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_code: code })
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn('[order] db-promo RPC fail', r.status, t);
      return null;
    }
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    if (redeem) return { discount_pct: row.discount_pct, remaining: row.remaining };
    // peek: respect active flag
    if (!row.active || row.remaining <= 0) return null;
    return { discount_pct: row.discount_pct, remaining: row.remaining };
  } catch (e) {
    console.warn('[order] db-promo exception', e.message);
    return null;
  }
}

async function saveOrderToSupabase(order) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/ulhome_orders`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(order)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn('[order] supabase insert failed', r.status, t);
      return null;
    }
    const rows = await r.json();
    return rows[0] || null;
  } catch (e) {
    console.error('[order] supabase exception', e.message);
    return null;
  }
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
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON' });
    }
  }
  body = body || {};

  if (!body.fio || !body.phone) {
    return res.status(400).json({ ok: false, error: 'Missing fio/phone' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing items' });
  }

  const stage = String(body.stage || 'final').toLowerCase();
  const isLead = stage === 'lead';

  if (!isLead) {
    const captcha = await verifyTurnstile(body.captchaToken, ip);
    if (!captcha.ok) {
      return res.status(403).json({ ok: false, error: 'Captcha failed', detail: captcha.errors || captcha.error });
    }
  }

  const priced = await recomputePrices(body.items);
  let authoritativeTotal = null;
  if (priced && priced.ok) {
    authoritativeTotal = Number(priced.total);
  } else {
    if (!isLead && body.payment === 'card') {
      return res.status(400).json({ ok: false, error: 'Price verification failed', detail: priced });
    }
    authoritativeTotal = (body.items || []).reduce(
      (s, it) => s + (parseFloat(it.price) || 0) * (parseInt(it.qty || 1, 10)), 0
    );
  }

  // [v7] Apply promo — legacy dict → DB peek/redeem.
  const promoCodeRaw = String(body.promoCode || '').toUpperCase().trim();
  let promoPct = 0;
  let promoSource = null;
  let promoRemaining = null;
  if (promoCodeRaw) {
    if (LEGACY_PROMOS[promoCodeRaw]) {
      promoPct = LEGACY_PROMOS[promoCodeRaw];
      promoSource = 'legacy';
    } else {
      // On lead → peek only (UI can show discount preview). On final → redeem atomically.
      const db = await resolveDbPromo(promoCodeRaw, !isLead);
      if (db) {
        promoPct = db.discount_pct;
        promoRemaining = db.remaining;
        promoSource = isLead ? 'db-peek' : 'db-redeem';
      }
    }
  }
  const originalTotal = authoritativeTotal;
  if (promoPct > 0) {
    authoritativeTotal = Math.round(originalTotal * (100 - promoPct)) / 100;
  }

  const orderRow = await saveOrderToSupabase({
    customer_name: body.fio,
    customer_phone: body.phone,
    customer_email: body.email || null,
    delivery_type: body.delivery_type || 'np',
    delivery_city: body.city || '',
    delivery_branch: body.wh || '',
    payment_method: body.payment || (isLead ? null : 'np'),
    payment_status: isLead ? 'lead' : (body.payment === 'card' ? 'pending' : 'cod'),
    items: body.items,
    total: authoritativeTotal,
    status: isLead ? 'lead' : 'new',
    notes: (body.comment || (isLead ? 'abandoned-cart lead' : '')) +
           (promoCodeRaw && promoPct ? `\npromo: ${promoCodeRaw} -${promoPct}% (${promoSource})` : '')
  });

  if (isLead) {
    return res.status(200).json({
      ok: true,
      stage: 'lead',
      order_num: body.num,
      supabase_order: orderRow ? orderRow.number : null,
      authoritative_total: authoritativeTotal,
      keycrm_id: null,
      promo: promoPct > 0 ? { code: promoCodeRaw, discount_pct: promoPct, remaining: promoRemaining, source: promoSource } : null,
      message: 'Lead saved to Supabase; KeyCRM deferred until final stage.'
    });
  }

  try {
    console.log('[order]', {
      num: body.num,
      city: body.city || '(empty)',
      wh: body.wh || '(empty)',
      payment: body.payment,
      promoCode: body.promoCode || null,
      promoPct: promoPct || 0,
      promoSource,
      promoRemaining,
      seasons: (body.items || []).map(it => ({ uid: it.uid, season: it.season || null }))
    });
  } catch(_){}

  const pmCard = parseInt(process.env.KEYCRM_PM_CARD || '0', 10);
  const pmNp   = parseInt(process.env.KEYCRM_PM_NP   || '0', 10);
  const paymentMethodId = body.payment === 'card' ? pmCard : pmNp;

  const crmPayload = {
    source_id: parseInt(process.env.KEYCRM_SOURCE_ID || '1', 10),
    manager_comment: `ultera-home · ${body.num || (orderRow && orderRow.number) || ''}${body.payment === 'np' ? ' · наложка (мін 500₴)' : ' · картка'}${promoPct > 0 ? ` · промо ${promoCodeRaw} −${promoPct}%` : ''}`,
    buyer: { full_name: body.fio, phone: body.phone },
    shipping: {
      delivery_service_id: parseInt(process.env.KEYCRM_DS_NP || '1', 10),
      shipping_address_city: body.city || '',
      shipping_address_region: '',
      shipping_receive_point: [body.city, body.wh].filter(Boolean).join(', '),
      recipient_full_name: body.fio,
      recipient_phone: body.phone
    },
    payments: paymentMethodId ? [{
      payment_method_id: paymentMethodId,
      amount: authoritativeTotal,
      status: 'not_paid',
      description: body.payment === 'card' ? 'Оплата карткою' : 'Наложений платіж'
    }] : [],
    products: (body.items || []).map(it => {
      const line = priced && priced.breakdown
        ? priced.breakdown.find(b => b.uid === String(it.uid || ''))
        : null;
      let unitPrice = line ? Number(line.unit_price) : (parseFloat(it.price) || 0);
      if (promoPct > 0) unitPrice = Math.round(unitPrice * (100 - promoPct)) / 100;
      return {
        sku: String(it.uid || ''),
        name: it.title + (it.color_name ? ' / ' + it.color_name : '') + (it.size ? ' / р.' + it.size : '') + (it.season ? ' / ' + it.season : ''),
        price: unitPrice,
        quantity: parseInt(it.qty || 1, 10),
        picture: it.photo || null
      };
    })
  };

  const token = process.env.KEYCRM_TOKEN;
  if (!token) {
    console.log('[MOCK] order:', JSON.stringify(crmPayload));
    return res.status(200).json({
      ok: true, mock: true,
      stage: 'final',
      order_num: body.num,
      supabase_order: orderRow ? orderRow.number : null,
      authoritative_total: authoritativeTotal,
      promo: promoPct > 0 ? { code: promoCodeRaw, discount_pct: promoPct, remaining: promoRemaining, source: promoSource } : null,
      message: 'Mock order logged.'
    });
  }

  try {
    const r = await fetch('https://openapi.keycrm.app/v1/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(crmPayload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('KeyCRM error', r.status, data);
      return res.status(r.status).json({ ok: false, error: data.message || 'KeyCRM error', details: data });
    }
    return res.status(200).json({
      ok: true,
      stage: 'final',
      order_num: body.num,
      supabase_order: orderRow ? orderRow.number : null,
      keycrm_id: data.id || null,
      authoritative_total: authoritativeTotal,
      promo: promoPct > 0 ? { code: promoCodeRaw, discount_pct: promoPct, remaining: promoRemaining, source: promoSource } : null
    });
  } catch (e) {
    console.error('KeyCRM exception', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
