// api/order-status.js — customer order-tracking cabinet backend (v1, 2026-06-03)
//
// Flow:
//   Frontend /order?ref=ULT-xxxxxxxx asks the buyer for their phone, then calls
//   GET /api/order-status?ref=...&phone=...  (POST {ref,phone} also accepted).
//
//   1. Find the order in ulhome_orders by payment_ref = ref.
//   2. Verify the supplied phone matches the order's customer_phone (last 9 digits).
//      -> prevents anyone with just the link from seeing order details.
//   3. Pull FRESH status + Nova Poshta TTN live from KeyCRM (by keycrm_id),
//      falling back to the cached keycrm_status_* columns if the live call fails
//      or the order isn't linked to KeyCRM yet.
//   4. Return a safe, customer-facing JSON (no email, no raw internal ids).
//
// Security: rate-limited per IP; generic errors (never reveal whether a ref
//   exists when the phone is wrong); CORS whitelist; Cache-Control: no-store.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KEYCRM_TOKEN

'use strict';

let keycrmMap = {};
try { keycrmMap = require('./_keycrm_map'); } catch (_) { keycrmMap = {}; }
const loadStatusMapFromSupabase = keycrmMap.loadStatusMapFromSupabase || (async () => null);
const classifyStatus = keycrmMap.classifyStatus || (() => null);
const DEFAULT_STATUS_MAP = keycrmMap.DEFAULT_STATUS_MAP || {};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEYCRM_BASE = 'https://openapi.keycrm.app/v1';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function checkRateLimit(ip, limit) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { allowed: true, skipped: true };
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/check_and_increment_rate_limit', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_ip: ip, p_endpoint: 'order-status', p_limit: limit })
    });
    if (!r.ok) return { allowed: true, skipped: true };
    return await r.json();
  } catch (e) { return { allowed: true, skipped: true }; }
}

function phoneDigits(s) {
  return String(s || '').replace(/\D/g, '');
}
// Compare by the last 9 significant digits (UA subscriber number, ignores +380 / 0 prefix).
function phoneMatches(a, b) {
  const da = phoneDigits(a), db = phoneDigits(b);
  if (da.length < 9 || db.length < 9) return false;
  return da.slice(-9) === db.slice(-9);
}

function maskPhone(s) {
  const d = phoneDigits(s);
  if (d.length < 4) return '***';
  return '***' + d.slice(-4);
}

function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

async function findOrderByRef(ref) {
  const cols = [
    'id', 'number', 'customer_name', 'customer_phone', 'created_at',
    'delivery_type', 'delivery_city', 'delivery_branch',
    'payment_method', 'payment_status', 'items', 'total', 'status',
    'keycrm_id', 'keycrm_status_id', 'keycrm_status_name', 'keycrm_status_group',
    'keycrm_status_updated_at', 'keycrm_status_raw'
  ].join(',');
  const path = SUPABASE_URL + '/rest/v1/ulhome_orders'
    + '?payment_ref=eq.' + encodeURIComponent(ref)
    + '&select=' + cols
    + '&order=created_at.desc&limit=1';
  const r = await fetch(path, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Accept': 'application/json' }
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Live KeyCRM fetch: fresh status_id + Nova Poshta TTN from the shipping block.
async function fetchKeycrmLive(keycrmId) {
  const token = process.env.KEYCRM_TOKEN;
  if (!token || !keycrmId) return null;
  try {
    const r = await fetch(KEYCRM_BASE + '/order/' + encodeURIComponent(keycrmId) + '?include=shipping', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch (e) { return null; }
}

function extractTracking(kcOrder, rawStatusFallback) {
  const candidates = [];
  const sh = (kcOrder && kcOrder.shipping) || null;
  if (sh) {
    candidates.push(sh.tracking_code, sh.tracking_number, sh.trackingNumber,
                    sh.declaration_id, sh.declaration, sh.shipping_tracking,
                    sh.tracking, sh.ttn);
  }
  if (kcOrder) candidates.push(kcOrder.tracking_code, kcOrder.tracking_number, kcOrder.ttn);
  let code = null;
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s && s.toLowerCase() !== 'null' && /\d{6,}/.test(s)) { code = s.replace(/\s+/g, ''); break; }
  }
  if (!code) return null;
  // Nova Poshta declarations are 14 digits → deep tracking link.
  const url = /^\d{14}$/.test(code)
    ? 'https://novaposhta.ua/tracking/?cargo_number=' + code
    : null;
  return { code, url };
}

// Map a KeyCRM status (label + business group) to a 4-stage customer timeline.
//   stage 1 Оплачено/Прийнято · 2 Підтверджено · 3 Відправлено · 4 Доставлено
function deriveStage(label, group) {
  const l = String(label || '').toLowerCase();
  if (group === 'rejected') return { stage: 0, cancelled: true };
  if (/достав|отрим|видан|видач|виконан|заверш|закрит|complete|done|deliver/.test(l)) return { stage: 4, cancelled: false };
  if (/відправ|відвантаж|у дороз|in.?transit|ship|sent/.test(l)) return { stage: 3, cancelled: false };
  if (/підтвердж|обробц|підготов|комплект|confirm|process|готуєтьс/.test(l)) return { stage: 2, cancelled: false };
  // pending / new / excluded / unknown → just accepted
  return { stage: 1, cancelled: false };
}

const STAGE_LABELS = ['', 'Прийнято', 'Підтверджено', 'Відправлено', 'Доставлено'];

function paymentLabel(method, status) {
  const m = String(method || '').toLowerCase();
  if (m === 'card') return 'Оплата карткою онлайн';
  if (m === 'np')   return 'Накладений платіж (передплата внесена)';
  return 'Оплата при отриманні';
}

function safeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map(it => ({
    title: String(it.title || it.name || 'Товар'),
    color: it.color_name ? String(it.color_name) : null,
    size:  it.size != null && it.size !== '' ? String(it.size) : null,
    qty:   Math.max(parseInt(it.qty || 1, 10) || 1, 1)
  }));
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, 20);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ ok: false, error: 'Забагато спроб. Зачекайте хвилину.', retry_after: rl.retry_after });
  }

  // Read params from query (GET) or JSON body (POST).
  let ref = '', phone = '';
  if (req.method === 'GET') {
    const q = req.query || {};
    ref = q.ref || q.order || '';
    phone = q.phone || '';
  } else {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};
    ref = body.ref || body.order || '';
    phone = body.phone || '';
  }
  ref = String(ref || '').trim().slice(0, 64);
  phone = String(phone || '').trim().slice(0, 32);

  if (!ref) return res.status(400).json({ ok: false, error: 'Не вказано номер замовлення.' });
  if (phoneDigits(phone).length < 9) {
    return res.status(400).json({ ok: false, error: 'Введіть коректний номер телефону.' });
  }

  let order;
  try { order = await findOrderByRef(ref); }
  catch (e) { return res.status(500).json({ ok: false, error: 'Помилка сервера. Спробуйте пізніше.' }); }

  // Generic response for both "no such ref" and "phone mismatch" — don't leak existence.
  const GENERIC_DENY = { ok: false, error: 'Замовлення не знайдено або номер телефону не співпадає.' };

  if (!order) return res.status(404).json(GENERIC_DENY);
  if (!phoneMatches(phone, order.customer_phone)) return res.status(403).json(GENERIC_DENY);

  // ---- Resolve status: live KeyCRM first, then cached columns ----
  const statusMap = (await loadStatusMapFromSupabase(SUPABASE_URL, SUPABASE_KEY)) || DEFAULT_STATUS_MAP;

  let label = order.keycrm_status_name || null;
  let group = order.keycrm_status_group || null;
  let statusUpdatedAt = order.keycrm_status_updated_at || null;
  let tracking = extractTracking({ shipping: null }, order.keycrm_status_raw);
  let live = false;

  if (order.keycrm_id) {
    const kc = await fetchKeycrmLive(order.keycrm_id);
    if (kc && (kc.id || kc.status_id != null || kc.status)) {
      live = true;
      const cls = classifyStatus(kc.status_id, kc.status, statusMap);
      if (cls) { label = cls.label; group = cls.group; }
      else if (kc.status && (kc.status.name || kc.status.title)) { label = kc.status.name || kc.status.title; }
      if (kc.updated_at || kc.status_updated_at) statusUpdatedAt = kc.updated_at || kc.status_updated_at;
      const t = extractTracking(kc);
      if (t) tracking = t;
    }
  }

  // No status info at all yet (freshly paid, not synced) → treat as accepted.
  if (!label) { label = STAGE_LABELS[1]; group = group || 'pending'; }

  const st = deriveStage(label, group);

  const payload = {
    ok: true,
    live,
    ref,
    number: order.number != null ? order.number : null,
    created_at: order.created_at || null,
    status: {
      label,
      group: group || 'pending',
      stage: st.stage,
      cancelled: st.cancelled,
      updated_at: statusUpdatedAt
    },
    stages: STAGE_LABELS.slice(1),
    tracking: tracking || null,
    delivery: {
      type: order.delivery_type || 'np',
      city: order.delivery_city || '',
      branch: order.delivery_branch || ''
    },
    payment: {
      method: order.payment_method || 'np',
      status: order.payment_status || null,
      label: paymentLabel(order.payment_method, order.payment_status)
    },
    items: safeItems(order.items),
    total: order.total != null ? Number(order.total) : null,
    customer: {
      first_name: firstName(order.customer_name),
      phone_masked: maskPhone(order.customer_phone)
    }
  };

  return res.status(200).json(payload);
};
