// api/tiktok-events.js — TikTok Events API helper (v1, 2026-06-23)
//
// Sends server-side events to TikTok Events API (v1.3) to complement the
// client-side TikTok Pixel. TikTok deduplicates by (event, event_id) when the
// same event_id is used on both sides — so pass the same orderReference
// everywhere (the client pixel CompletePayment uses event_id = orderReference).
//
// If TIKTOK_ACCESS_TOKEN is missing, every call becomes a no-op and returns
// { ok:false, skipped:true }. This lets the server ship safely before the env
// var is configured in Vercel.
//
// Env vars:
//   TIKTOK_ACCESS_TOKEN     required — Events API token from TikTok Events Manager
//   TIKTOK_PIXEL_ID         optional — defaults to the ULTERA pixel code
//   TIKTOK_TEST_EVENT_CODE  optional — for Events Manager → Test Events debugging
//
// Usage:
//   const { sendTikTokEvent } = require('./tiktok-events');
//   await sendTikTokEvent('CompletePayment', {
//     event_id: orderReference,
//     event_source_url: 'https://ultera.in.ua/?paid=1',
//     user_data: { em:['client@example.com'], ph:['380501234567'],
//                  client_ip_address: ip, client_user_agent: ua, ttp, ttclid },
//     custom_data: { currency:'UAH', value:1299, content_ids:['uid1'],
//                    content_type:'product', contents:[...] }
//   });

const crypto = require('crypto');

const API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
const DEFAULT_PIXEL = 'D39G1P3C77UFKOQ7L4QG';

function sha256(s) {
  if (s == null) return null;
  const norm = String(s).trim().toLowerCase();
  if (!norm) return null;
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

// Normalize a phone to E.164 (Ukraine-aware) before hashing, per TikTok spec.
function sha256Phone(s) {
  if (s == null) return null;
  let d = String(s).replace(/\D+/g, '');
  if (!d) return null;
  if (d.length === 10 && d[0] === '0') d = '380' + d.slice(1); // 0XXXXXXXXX -> 380XXXXXXXXX
  else if (d.length === 9) d = '380' + d;                       // XXXXXXXXX  -> 380XXXXXXXXX
  // else assume already includes country code (e.g. 380XXXXXXXXX)
  return crypto.createHash('sha256').update('+' + d, 'utf8').digest('hex');
}

function firstHashed(arr, fn) {
  if (arr == null) return undefined;
  if (!Array.isArray(arr)) arr = [arr];
  for (let i = 0; i < arr.length; i++) {
    const h = fn(arr[i]);
    if (h) return h;
  }
  return undefined;
}

function buildUser(u) {
  u = u || {};
  const out = {};
  const em = firstHashed(u.em, sha256);            if (em) out.email = em;
  const ph = firstHashed(u.ph, sha256Phone);       if (ph) out.phone = ph;
  const ex = firstHashed(u.external_id, sha256);   if (ex) out.external_id = ex;
  // IP / UA / ttp / ttclid are raw (not hashed).
  if (u.client_ip_address) out.ip = String(u.client_ip_address);
  if (u.client_user_agent) out.user_agent = String(u.client_user_agent);
  if (u.ttp)    out.ttp = String(u.ttp);
  if (u.ttclid) out.ttclid = String(u.ttclid);
  return out;
}

// Map FB-style custom_data to TikTok properties.contents.
function buildProperties(c) {
  c = c || {};
  const props = {};
  if (c.currency) props.currency = c.currency;
  if (c.value != null) props.value = Number(c.value);
  if (c.content_type) props.content_type = c.content_type;
  if (Array.isArray(c.contents) && c.contents.length) {
    props.contents = c.contents;
  } else if (Array.isArray(c.content_ids) && c.content_ids.length) {
    props.contents = c.content_ids.map(function (id) {
      return { content_id: String(id), content_type: c.content_type || 'product' };
    });
  }
  return props;
}

async function sendTikTokEvent(eventName, opts) {
  const token   = process.env.TIKTOK_ACCESS_TOKEN;
  const pixelId = process.env.TIKTOK_PIXEL_ID || DEFAULT_PIXEL;
  const testCode = process.env.TIKTOK_TEST_EVENT_CODE || null;

  if (!token) {
    return { ok: false, skipped: true, reason: 'TIKTOK_ACCESS_TOKEN not set' };
  }

  opts = opts || {};
  const event = {
    event: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: opts.event_id || undefined,
    user: buildUser(opts.user_data),
    properties: buildProperties(opts.custom_data)
  };
  if (opts.event_source_url) event.page = { url: opts.event_source_url };
  Object.keys(event).forEach(function (k) { if (event[k] === undefined) delete event[k]; });

  const payload = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [event]
  };
  if (testCode) payload.test_event_code = testCode;

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(function () { return {}; });
    if (!r.ok || (data && data.code !== 0 && data.code !== undefined)) {
      console.warn('[tiktok-events]', eventName, 'HTTP', r.status, 'code', data && data.code, data && data.message);
      return { ok: false, status: r.status, code: data && data.code, error: data };
    }
    return { ok: true, request_id: data && data.request_id };
  } catch (e) {
    console.error('[tiktok-events] exception', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendTikTokEvent, sha256, sha256Phone };
