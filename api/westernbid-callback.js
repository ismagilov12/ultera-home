// api/westernbid-callback.js — Western Bid IPN (server-to-server).
// WB POSTs payment result here. We verify the md5 signature, look up the order
// by the number embedded in `invoice`, and (only on a valid, first-time
// 'Completed' notification) mark it paid + fire Meta CAPI Purchase and a
// Telegram admin notice. Idempotent: a repeat IPN for an already-paid order is
// a no-op 200.
//
// Env vars:
//   WB_LOGIN, WB_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FB_PIXEL_ID (default 1861447568005608), FB_CAPI_TOKEN (optional)
//   TG_BOT_TOKEN, TG_ADMIN_CHAT_ID (optional)
//   WB_CURRENCY (default 'EUR')

const crypto = require('crypto');

function md5(s) { return crypto.createHash('md5').update(String(s), 'utf8').digest('hex'); }

function parseBody(req) {
  let b = req.body;
  if (b && typeof b === 'object') return b;
  const raw = typeof b === 'string' ? b : '';
  const out = {};
  try {
    const p = new URLSearchParams(raw);
    p.forEach(function (v, k) { out[k] = v; });
  } catch (e) { /* ignore */ }
  return out;
}

async function findOrderByNumber(number) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !number) return null;
  try {
    const q = url + '/rest/v1/ulhome_orders?number=eq.' + encodeURIComponent(number) +
      '&select=id,number,payment_status,total,customer_name,customer_phone,customer_email,items,notes&limit=1';
    const r = await fetch(q, { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (e) { return null; }
}

async function markPaid(id) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !id) return false;
  try {
    const r = await fetch(url + '/rest/v1/ulhome_orders?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ payment_status: 'paid' })
    });
    return r.ok;
  } catch (e) { console.error('[wb-cb] markPaid exception', e.message); return false; }
}

async function metaCapiPurchase(order, invoice, amountForeign, currency, payerEmail) {
  const pixel = process.env.FB_PIXEL_ID || '1861447568005608';
  const token = process.env.FB_CAPI_TOKEN;
  if (!token) return;
  try {
    const sha = function (v) { return v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined; };
    const user = {};
    const em = sha(payerEmail || order.customer_email);
    if (em) user.em = [em];
    const ph = (order.customer_phone || '').replace(/[^0-9]/g, '');
    if (ph) user.ph = [crypto.createHash('sha256').update(ph).digest('hex')];
    const payload = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: invoice,
        action_source: 'website',
        user_data: user,
        custom_data: { currency: currency, value: Number(amountForeign) }
      }]
    };
    await fetch('https://graph.facebook.com/v19.0/' + pixel + '/events?access_token=' + encodeURIComponent(token), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
  } catch (e) { console.warn('[wb-cb] capi fail', e.message); }
}

async function notifyTelegram(order, invoice, amountForeign, currency, txnId) {
  const tgToken = process.env.TG_BOT_TOKEN;
  const chat = process.env.TG_ADMIN_CHAT_ID;
  if (!tgToken || !chat) return;
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); };
  const text = [
    '💳✅ <b>WB ОПЛАЧЕНО (US/EU)</b>',
    '№ ' + esc(order.number) + ' · invoice ' + esc(invoice),
    '💰 <b>' + esc(amountForeign) + ' ' + esc(currency) + '</b> (≈ ' + esc(Math.round(Number(order.total) || 0)) + ' ₴)',
    '👤 ' + esc(order.customer_name || '—') + ' · ' + esc(order.customer_phone || '—'),
    order.customer_email ? ('✉️ ' + esc(order.customer_email)) : null,
    txnId ? ('🧾 txn ' + esc(txnId)) : null
  ].filter(function (x) { return x != null; }).join('\n');
  try {
    await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (e) { console.warn('[wb-cb] tg fail', e.message); }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Method not allowed'); }

  const b = parseBody(req);
  const wbHash = b.wb_hash || '';
  const wbResult = b.wb_result || '';
  const mcGross = b.mc_gross || '';
  const mcCurrency = String(b.mc_currency || '').toUpperCase();
  const invoice = b.invoice || '';
  const paymentStatus = b.payment_status || '';
  const payerEmail = b.payer_email || '';
  const txnId = b.transaction_id || b.txn_id || '';

  const wbLogin = process.env.WB_LOGIN;
  const wbSecret = process.env.WB_SECRET;
  if (!wbLogin || !wbSecret) { console.error('[wb-cb] WB creds missing'); return res.status(500).send('config'); }

  // Verify signature: md5( wb_login + wb_result + secret + mc_gross + invoice )
  const expected = md5(wbLogin + wbResult + wbSecret + mcGross + invoice);
  if (String(wbHash).toUpperCase() !== expected.toUpperCase()) {
    console.warn('[wb-cb] signature mismatch for invoice', invoice);
    return res.status(403).send('bad signature');
  }

  // WB prepends "<wb_login>-" to the invoice, so match ULH-<number>- anywhere.
  const m = /ULH-([^-]+)-/.exec(String(invoice));
  const number = m ? m[1] : null;
  const order = await findOrderByNumber(number);
  if (!order) { console.warn('[wb-cb] order not found for invoice', invoice); return res.status(200).send('OK'); }

  // Idempotency: already paid → no-op.
  if (String(order.payment_status).toLowerCase() === 'paid') return res.status(200).send('OK');

  // WB verification result must be VERIFIED and status Completed.
  if (String(wbResult).toUpperCase() !== 'VERIFIED') {
    console.warn('[wb-cb] wb_result not VERIFIED (', wbResult, ') for', invoice); return res.status(200).send('OK');
  }
  if (String(paymentStatus).toLowerCase() !== 'completed') {
    console.log('[wb-cb] status', paymentStatus, 'for', invoice, '- no state change');
    return res.status(200).send('OK');
  }

  // Anti-tamper: confirm paid amount + currency match what we recorded (from notes "WB <CUR> <AMOUNT> @ ...").
  const currency = String(process.env.WB_CURRENCY || 'EUR').toUpperCase();
  const expM = /WB\s+([A-Z]{3})\s+([\d.]+)/.exec(String(order.notes || ''));
  if (expM) {
    const expCur = expM[1];
    const expAmt = Number(expM[2]);
    const gotAmt = Number(mcGross);
    if (mcCurrency && mcCurrency !== expCur) {
      console.error('[wb-cb] CURRENCY MISMATCH', invoice, 'expected', expCur, 'got', mcCurrency, '- NOT marking paid');
      return res.status(200).send('OK');
    }
    if (isFinite(gotAmt) && isFinite(expAmt) && Math.abs(gotAmt - expAmt) > 0.02) {
      console.error('[wb-cb] AMOUNT MISMATCH', invoice, 'expected', expAmt, 'got', gotAmt, '- NOT marking paid');
      return res.status(200).send('OK');
    }
  }

  await markPaid(order.id);

  // Best-effort side effects (do not block / fail the 200 WB expects).
  try { metaCapiPurchase(order, invoice, mcGross, currency, payerEmail).catch(function () {}); } catch (e) {}
  try { notifyTelegram(order, invoice, mcGross, currency, txnId).catch(function () {}); } catch (e) {}

  return res.status(200).send('OK');
};
