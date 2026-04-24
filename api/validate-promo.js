// api/validate-promo.js — check promo code validity (non-mutating, frontend use)
// Flow: frontend shows code modal with "remaining X з Y". We call peek RPC via
// service_role on server, return discount+remaining. Actual redemption happens
// only inside api/order.js at final stage via ulhome_redeem_promo() (atomic).
//
// Contract:
//   POST /api/validate-promo { code: "ULTERA10" }
//   → 200 { ok:true, valid:true|false, code, discount_pct, remaining }
//   → 429 if rate-limited
//
// [v2 2026-04-24] Hardcoded PROMOS table short-circuits before DB peek, so
// SALE1 / ULTERA10 always validate green regardless of DB rows. Keep this
// table in sync with api/order.js LEGACY_PROMOS and api/wayforpay.js PROMOS.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const HARDCODED_PROMOS = { 'SALE1': 5, 'ULTERA10': 10 };

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
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

async function checkRateLimit(ip, limit) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { allowed: true, skipped: true };
  try {
    const r = await fetch(`${url}/rest/v1/rpc/check_and_increment_rate_limit`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_ip: ip, p_endpoint: 'promo', p_limit: limit })
    });
    if (!r.ok) return { allowed: true, skipped: true };
    return await r.json();
  } catch (e) {
    return { allowed: true, skipped: true };
  }
}

async function peekPromo(code) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { err: 'no-supabase-env' };
  const r = await fetch(`${url}/rest/v1/rpc/ulhome_peek_promo`, {
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
    return { err: 'rpc-http-' + r.status, detail: t };
  }
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) return { notFound: true };
  return { row: rows[0] };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, 30); // promo check is cheap, allow 30/min
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON' });
    }
  }
  body = body || {};

  const code = String(body.code || '').trim().toUpperCase();
  if (!code || code.length > 32) {
    return res.status(400).json({ ok: false, error: 'Invalid code' });
  }

  // [v2] Hardcoded shortcut — always-valid codes do not consume DB usage counter.
  if (HARDCODED_PROMOS[code]) {
    return res.status(200).json({
      ok: true,
      valid: true,
      code,
      discount_pct: HARDCODED_PROMOS[code],
      remaining: null,
      source: 'hardcoded'
    });
  }

  const peek = await peekPromo(code);
  if (peek.err) {
    console.warn('[validate-promo] peek error', peek);
    return res.status(500).json({ ok: false, error: 'peek failed' });
  }
  if (peek.notFound) {
    return res.status(200).json({ ok: true, valid: false, code, reason: 'not-found' });
  }
  const { discount_pct, remaining, active } = peek.row;
  return res.status(200).json({
    ok: true,
    valid: !!active && remaining > 0,
    code,
    discount_pct,
    remaining
  });
};
