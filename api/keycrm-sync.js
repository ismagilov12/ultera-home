// api/keycrm-sync.js — наскрізна аналітика ULTERA: KeyCRM → ulhome_orders.
// Викликається:
//   1) Vercel Cron (vercel.json) кожні 5 хв з GET /api/keycrm-sync (default action=sync).
//   2) Адміном з admin.html через GET /api/keycrm-sync?action=statuses (discovery)
//      або POST /api/keycrm-sync?action=backfill (одноразовий бекфіл).
//
// Auth:
//   - Cron + admin викликають з заголовком Authorization: Bearer <KEYCRM_SYNC_TOKEN>.
//   - Vercel Cron автоматично підставляє цей header якщо CRON_SECRET налаштований у env.
//   - Adсин у admin.html передає той самий токен з input field.
//   - action=statuses також вимагає auth (щоб не дамапити структуру публічно).
//
// Env vars (Vercel):
//   KEYCRM_TOKEN              — Bearer token KeyCRM API
//   KEYCRM_SYNC_TOKEN         — наш shared secret для аутентифікації endpoint
//   SUPABASE_URL              — https://...supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role JWT
//
// Версія: v1.4 (2026-04-28) — мінімальний since = 2026-04-25, скидає старий курсор з 2023 (2026-04-28) — include=buyer.contacts (KeyCRM повертає buyer лише з include),
//             debug=skipped_sample у вiдповiдi для дiагностики

'use strict';

const { loadStatusMapFromSupabase, classifyStatus, DEFAULT_STATUS_MAP } = require('./_keycrm_map');

const KEYCRM_BASE = 'https://openapi.keycrm.app/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ===== Auth =====
function isAuthorized(req) {
  const expected = process.env.KEYCRM_SYNC_TOKEN || process.env.CRON_SECRET;
  if (!expected) return false;
  const hdr = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (hdr === 'Bearer ' + expected) return true;
  // ?token=... як fallback (для ручних викликів з браузера)
  const url = new URL(req.url || '/', 'http://x');
  if (url.searchParams.get('token') === expected) return true;
  return false;
}

function getAction(req) {
  const url = new URL(req.url || '/', 'http://x');
  return (url.searchParams.get('action') || 'sync').toLowerCase();
}

// ===== KeyCRM helpers =====
async function keycrmGet(path, params) {
  const token = process.env.KEYCRM_TOKEN;
  if (!token) throw new Error('KEYCRM_TOKEN env not set');
  const qs = params
    ? '?' + Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  const r = await fetch(KEYCRM_BASE + path + qs, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json'
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!r.ok) {
    const err = new Error('KeyCRM ' + r.status + ': ' + (data.message || text.slice(0, 200)));
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ===== Supabase helpers =====
async function sbRest(path, opts = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL/KEY not set');
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  if (!r.ok) {
    const err = new Error('Supabase ' + r.status + ': ' + text.slice(0, 200));
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function getSyncCursor() {
  const rows = await sbRest('ulhome_sync_state?key=eq.keycrm_sync&select=value', {});
  if (!Array.isArray(rows) || rows.length === 0) return { last_updated_at: null };
  return rows[0].value || { last_updated_at: null };
}

async function setSyncCursor(value) {
  await sbRest('ulhome_sync_state?key=eq.keycrm_sync', {
    method: 'PATCH',
    body: JSON.stringify({ value, updated_at: new Date().toISOString() })
  });
}

// Витягнути ulhome_orders, що відповідають списку зовнішніх id або keycrm_id.
async function findOurOrdersForKeycrmList(keycrmOrders) {
  // Будуємо OR-запит: external_id=eq.X або keycrm_id=eq.Y
  const externalIds = keycrmOrders
    .map(o => (o.external_id != null ? String(o.external_id) : null))
    .filter(x => x && /^[0-9]+$/.test(x));
  const keycrmIds = keycrmOrders
    .map(o => (o.id != null ? parseInt(o.id, 10) : null))
    .filter(x => Number.isFinite(x));
  if (externalIds.length === 0 && keycrmIds.length === 0) return [];

  const orParts = [];
  if (keycrmIds.length)   orParts.push('keycrm_id.in.(' + keycrmIds.join(',') + ')');
  if (externalIds.length) orParts.push('number.in.(' + externalIds.join(',') + ')');
  if (externalIds.length) orParts.push('keycrm_external_id.in.(' + externalIds.map(x => '"' + x + '"').join(',') + ')');
  const orQuery = orParts.join(',');
  const path = `ulhome_orders?select=id,number,keycrm_id,keycrm_external_id,customer_phone,created_at&or=(${orQuery})`;
  return await sbRest(path);
}

function buildPatchPayload(keycrmOrder, classified) {
  const statusId = parseInt(keycrmOrder.status_id, 10);
  const statusObj = keycrmOrder.status || null;
  const updatedAt = keycrmOrder.updated_at || keycrmOrder.status_updated_at || null;
  return {
    keycrm_id:                parseInt(keycrmOrder.id, 10),
    keycrm_external_id:       keycrmOrder.external_id != null ? String(keycrmOrder.external_id) : null,
    keycrm_status_id:         Number.isFinite(statusId) ? statusId : null,
    keycrm_status_name:       classified ? classified.label : (statusObj ? (statusObj.name || statusObj.title) : null),
    keycrm_status_group:      classified ? classified.group : null,
    keycrm_status_raw:        statusObj,
    keycrm_status_updated_at: updatedAt,
    keycrm_synced_at:         new Date().toISOString()
  };
}

async function upsertByKeycrmId(payload) {
  // Спочатку UPDATE по keycrm_id (якщо вже звʼязані)
  const upd = await sbRest(
    `ulhome_orders?keycrm_id=eq.${payload.keycrm_id}&select=id`,
    { method: 'PATCH', body: JSON.stringify(payload), headers: { 'Prefer': 'return=representation' } }
  );
  return Array.isArray(upd) ? upd.length : 0;
}

async function linkByExternalId(payload) {
  // Якщо ще не зв'язані — спробувати знайти по keycrm_external_id або number
  const ext = payload.keycrm_external_id;
  if (!ext) return 0;
  // 1) спершу keycrm_external_id
  let upd = await sbRest(
    `ulhome_orders?keycrm_external_id=eq.${encodeURIComponent(ext)}&keycrm_id=is.null&select=id`,
    { method: 'PATCH', body: JSON.stringify(payload), headers: { 'Prefer': 'return=representation' } }
  );
  if (Array.isArray(upd) && upd.length) return upd.length;
  // 2) fallback по number (якщо external_id = number нашого order)
  if (/^[0-9]+$/.test(ext)) {
    upd = await sbRest(
      `ulhome_orders?number=eq.${ext}&keycrm_id=is.null&select=id`,
      { method: 'PATCH', body: JSON.stringify(payload), headers: { 'Prefer': 'return=representation' } }
    );
    if (Array.isArray(upd) && upd.length) return upd.length;
  }
  return 0;
}


// v1.2: Fallback — match by phone (last 9 digits) + created_at ±72h.
// Потрiбен для замовлень, що були створенi до того як api/order.js v9 почав
// записувати keycrm_external_id (тобто все що до 2026-04-28 деплою).
async function linkByPhone(payload, kcOrder) {
  // KeyCRM phone може бути у багатьох мiсцях залежно вiд include параметрiв
  let phone = null;
  const b = kcOrder.buyer || {};
  if (b.phone) phone = b.phone;
  if (!phone && Array.isArray(b.phones) && b.phones.length) phone = b.phones[0].phone || b.phones[0].value || b.phones[0];
  if (!phone && Array.isArray(b.contacts)) {
    for (const c of b.contacts) {
      if (c && (c.type === 'phone' || c.contact_type === 'phone' || c.value_type === 'phone') && c.value) {
        phone = c.value; break;
      }
      // Sometimes contacts have just {value: '+380...'}
      if (c && typeof c.value === 'string' && /^\+?[0-9 ()\-]{8,}$/.test(c.value)) { phone = c.value; break; }
    }
  }
  if (!phone) phone = kcOrder.contact_phone || kcOrder.phone || null;
  if (!phone) return 0;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 9) return 0;
  const last9 = digits.slice(-9);
  // Час створення в KeyCRM
  const created = kcOrder.created_at || kcOrder.ordered_at || payload.keycrm_status_updated_at;
  if (!created) return 0;
  const dt = new Date(created);
  if (isNaN(dt.getTime())) return 0;
  const lo = new Date(dt.getTime() - 72 * 3600 * 1000).toISOString();
  const hi = new Date(dt.getTime() + 72 * 3600 * 1000).toISOString();
  // Шукаємо рядок з тим же телефоном (LIKE *last9*) у вiкнi ±72 год
  const path = 'ulhome_orders?keycrm_id=is.null'
             + '&customer_phone=ilike.' + encodeURIComponent('*' + last9 + '*')
             + '&created_at=gte.' + encodeURIComponent(lo)
             + '&created_at=lte.' + encodeURIComponent(hi)
             + '&select=id,number,customer_phone,created_at'
             + '&order=created_at.desc&limit=1';
  let rows;
  try { rows = await sbRest(path); } catch (e) { return 0; }
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const target = rows[0];
  try {
    await sbRest('ulhome_orders?id=eq.' + encodeURIComponent(target.id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'Prefer': 'return=minimal' }
    });
    return 1;
  } catch (e) {
    console.warn('[keycrm-sync] linkByPhone PATCH fail', target.id, e.message);
    return 0;
  }
}

// ===== Action handlers =====
async function actionStatuses() {
  // GET /v1/order/status — повертає список доступних статусів цього аккаунта.
  const data = await keycrmGet('/order/status', {});
  // KeyCRM зазвичай повертає { data: [...] } або просто масив
  const list = Array.isArray(data) ? data : (data.data || data.items || []);
  return {
    ok: true,
    action: 'statuses',
    count: list.length,
    statuses: list.map(s => ({
      id:    s.id,
      name:  s.name || s.title,
      color: s.color || null,
      group_id: s.group_id || null
    })),
    raw_sample: list.slice(0, 1)
  };
}

async function actionSync({ sinceOverride, limit, force }) {
  const cursor = await getSyncCursor();
  let since = sinceOverride || cursor.last_updated_at || null;
  // v1.4: KeyCRM має 2 роки старих замовлень. ULTERA-аналітика стартувала 25.04.2026 —
  // все старіше нерелевантне і "забивало" курсор. Завжди тримаємо since >= 2026-04-25.
  const ULTERA_CUTOFF = '2026-04-25T00:00:00Z';
  if (!since || since < ULTERA_CUTOFF) since = ULTERA_CUTOFF;

  const pageLimit = Math.min(parseInt(limit || 50, 10), 50);

  // KeyCRM v1: GET /order?include=products&filter[updated_between]=since,now&sort=updated_at,asc
  const params = {
    'include':            'buyer,products',
    'limit':              pageLimit,
    'sort':               'updated_at'
  };
  if (since) params['filter[updated_between]'] = since + ',' + new Date().toISOString();

  // v1.2: multi-page fetch (KeyCRM hard-limit 50/page).
  // Тягнемо до 5 сторiнок за один виклик щоб ручний "Синхронiзувати" все вибирав.
  const allOrders = [];
  for (let pg = 1; pg <= 5; pg++) {
    const pgParams = Object.assign({}, params, { page: pg });
    const data = await keycrmGet('/order', pgParams);
    const arr = Array.isArray(data) ? data : (data.data || []);
    if (!arr || arr.length === 0) break;
    allOrders.push.apply(allOrders, arr);
    if (arr.length < pageLimit) break;
  }
  const orders = allOrders;

  const statusMap = (await loadStatusMapFromSupabase(SUPABASE_URL, SUPABASE_KEY)) || DEFAULT_STATUS_MAP;

  let updated = 0;
  let linked = 0;
  let skipped = 0;
  let lastSeen = since;
  const skippedSample = []; // v1.3 diagnostic

  for (const ko of orders) {
    const cls = classifyStatus(ko.status_id, ko.status, statusMap);
    const payload = buildPatchPayload(ko, cls);
    if (ko.updated_at && (!lastSeen || ko.updated_at > lastSeen)) lastSeen = ko.updated_at;
    try {
      const u = await upsertByKeycrmId(payload);
      if (u > 0) { updated += u; continue; }
      const l = await linkByExternalId(payload);
      if (l > 0) { linked += l; continue; }
      // v1.2: phone+date fallback for legacy orders without keycrm_external_id
      const p = await linkByPhone(payload, ko);
      if (p > 0) { linked += p; continue; }
      skipped++;
      if (skippedSample.length < 5) {
        skippedSample.push({
          keycrm_id: payload.keycrm_id,
          external_id: payload.keycrm_external_id,
          buyer_id: ko.buyer_id || (ko.buyer && ko.buyer.id) || null,
          phone_present: !!(ko.buyer && (ko.buyer.phone || (Array.isArray(ko.buyer.phones) && ko.buyer.phones[0]) || (Array.isArray(ko.buyer.contacts) && ko.buyer.contacts[0]))),
          created_at: ko.created_at || null
        });
      }
    } catch (e) {
      console.error('[keycrm-sync] row error', payload.keycrm_id, e.message);
      skipped++;
    }
  }

  // Зсуваємо курсор тільки якщо щось обробили (інакше залишимо як було).
  if (lastSeen && lastSeen !== since) {
    await setSyncCursor({
      last_updated_at: lastSeen,
      last_run_at:     new Date().toISOString(),
      last_count:      orders.length,
      last_updated:    updated,
      last_linked:     linked,
      last_skipped:    skipped
    });
  } else {
    // Просто оновити last_run_at щоб бачити в адмінці що крон тиче
    await setSyncCursor({
      ...cursor,
      last_run_at:  new Date().toISOString(),
      last_count:   orders.length,
      last_updated: updated,
      last_linked:  linked,
      last_skipped: skipped
    });
  }

  return {
    ok:           true,
    action:       'sync',
    since,
    fetched:      orders.length,
    updated,
    linked,
    skipped,
    next_cursor:  lastSeen,
    has_more:     false,
    skipped_sample: skippedSample  // v1.3 diagnostic
  };
}

async function actionBackfill({ sinceIso, limit }) {
  // Скидаємо курсор і робимо повний sync з вказаної дати.
  // Якщо немає sinceIso — беремо created_at найстарішого ulhome_orders.
  let since = sinceIso;
  if (!since) {
    const rows = await sbRest('ulhome_orders?select=created_at&order=created_at.asc&limit=1');
    since = (rows && rows[0]) ? rows[0].created_at : '2026-01-01T00:00:00Z';
  }
  // Запускаємо до 5 послідовних syncs (по 50 шт)
  const all = { rounds: [], total_updated: 0, total_linked: 0, total_skipped: 0 };
  let round = 0;
  let lastCursor = since;
  while (round < 5) {
    round++;
    const r = await actionSync({ sinceOverride: lastCursor, limit, force: true });
    all.rounds.push(r);
    all.total_updated += r.updated || 0;
    all.total_linked  += r.linked  || 0;
    all.total_skipped += r.skipped || 0;
    if (!r.has_more) break;
    if (r.next_cursor === lastCursor) break;
    lastCursor = r.next_cursor;
  }
  return { ok: true, action: 'backfill', since, ...all };
}

// ===== Handler =====
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const action = getAction(req);
  const url = new URL(req.url || '/', 'http://x');

  try {
    if (action === 'statuses') {
      const out = await actionStatuses();
      return res.status(200).json(out);
    }
    if (action === 'backfill') {
      const sinceIso = url.searchParams.get('since') || null;
      const limit    = url.searchParams.get('limit') || 50;
      const out = await actionBackfill({ sinceIso, limit });
      return res.status(200).json(out);
    }
    // default: incremental sync
    const limit = url.searchParams.get('limit') || 50;
    const out = await actionSync({ sinceOverride: null, limit });
    return res.status(200).json(out);
  } catch (e) {
    console.error('[keycrm-sync] FAIL', e.message, e.body || '');
    return res.status(e.status || 500).json({
      ok: false,
      action,
      error: e.message,
      details: e.body || null
    });
  }
};
