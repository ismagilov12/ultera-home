// api/fb-capi.js — Facebook Conversions API helper (v1, 2026-04-22)
//
// Sends server-side events to Meta Graph API to complement the client-side
// Pixel. Meta deduplicates by (event_name, event_id) when the same event_id
// is used on both sides — so pass the same orderReference/event_id everywhere.
//
// If env vars are missing, every call becomes a no-op and returns { ok:false,
// skipped:true }. This lets the server ship safely before the Business Manager
// admin generates the Access Token.
//
// Env vars (all optional — CAPI silently disabled if any missing):
//   FB_PIXEL_ID       e.g. "1861447568005608"
//   FB_CAPI_TOKEN     long EAA... token from Events Manager → Conversions API
//   FB_TEST_EVENT_CODE (optional) for Events Manager → Test Events debugging
//
// Usage:
//   const { sendCAPI } = require('./fb-capi');
//   await sendCAPI('Purchase', {
//     event_id: orderReference,
//     event_source_url: 'https://ultera.in.ua/?paid=1',
//     user_data: { em: ['client@example.com'], ph: ['380501234567'],
//                  fn: 'Иван', ln: 'Петров',
//                  client_ip_address: ip, client_user_agent: ua, fbp, fbc },
//     custom_data: { currency:'UAH', value:1299, content_ids:['uid1'], content_type:'product' }
//   });

const crypto = require('crypto');

const GRAPH_VERSION = 'v20.0';

function sha256Lower(s) {
  if (s == null) return null;
  const norm = String(s).trim().toLowerCase();
  if (!norm) return null;
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

// Phone: strip everything except digits before hashing (Meta spec).
function sha256Phone(s) {
  if (s == null) return null;
  const digits = String(s).replace(/\D+/g, '');
  if (!digits) return null;
  return crypto.createHash('sha256').update(digits, 'utf8').digest('hex');
}

function hashList(arr, fn) {
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map(fn).filter(Boolean);
}

function buildUserData(u) {
  u = u || {};
  const out = {};
  if (u.em) out.em = hashList(u.em, sha256Lower);
  if (u.ph) out.ph = hashList(u.ph, sha256Phone);
  if (u.fn) out.fn = hashList([u.fn], sha256Lower);
  if (u.ln) out.ln = hashList([u.ln], sha256Lower);
  if (u.external_id) out.external_id = hashList([u.external_id], sha256Lower);
  // IP/UA/fbp/fbc are NOT hashed — Meta expects raw values.
  if (u.client_ip_address) out.client_ip_address = String(u.client_ip_address);
  if (u.client_user_agent) out.client_user_agent = String(u.client_user_agent);
  if (u.fbp) out.fbp = String(u.fbp);
  if (u.fbc) out.fbc = String(u.fbc);
  return out;
}

async function sendCAPI(eventName, opts) {
  const pixelId   = process.env.FB_PIXEL_ID;
  const token     = process.env.FB_CAPI_TOKEN;
  const testCode  = process.env.FB_TEST_EVENT_CODE || null;

  if (!pixelId || !token) {
    return { ok: false, skipped: true, reason: 'FB_PIXEL_ID or FB_CAPI_TOKEN not set' };
  }

  opts = opts || {};
  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_id: opts.event_id || undefined,
    event_source_url: opts.event_source_url || undefined,
    user_data: buildUserData(opts.user_data),
    custom_data: opts.custom_data || undefined
  };
  // Strip undefined keys (Meta rejects them)
  Object.keys(event).forEach(k => { if (event[k] === undefined) delete event[k]; });

  const payload = { data: [event] };
  if (testCode) payload.test_event_code = testCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.warn('[fb-capi]', eventName, 'HTTP', r.status, data);
      return { ok: false, status: r.status, error: data };
    }
    return { ok: true, events_received: data.events_received, fbtrace_id: data.fbtrace_id };
  } catch (e) {
    console.error('[fb-capi] exception', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendCAPI, sha256Lower, sha256Phone };
