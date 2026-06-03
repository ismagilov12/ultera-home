// api/wfp-return.js
// User-facing return endpoint after WayForPay payment.
// WFP redirects the customer's browser via POST (default) or GET to this URL
// with a form payload (orderReference, transactionStatus, amount, etc.).
// We accept BOTH methods, log the hit for diagnostics, and 302-redirect to
// the customer cabinet "/order?ref=...&paid=1" so the buyer can track status.
//
// v2 (2026-06-03): redirect target changed from "/?paid=1&order=..." (homepage
//   success overlay) to "/order?ref=...&paid=1" (order tracking cabinet).
//   On a declined/failed payment we still send them to the cabinet with paid=0
//   so they see the order and a retry hint rather than a dead end.
//
// Why this file exists:
//   returnUrl must not point at a static file — Vercel's static handler returns
//   405 to WFP's POST-back. This endpoint accepts POST/GET and 302-redirects.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel auto-parses application/json and application/x-www-form-urlencoded.
  // For safety, also handle a raw string body fallback.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      try {
        const parsed = {};
        body.split('&').forEach(p => {
          if (!p) return;
          const [k, v] = p.split('=');
          if (!k) return;
          parsed[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent((v || '').replace(/\+/g, ' '));
        });
        body = parsed;
      } catch (_) {
        body = {};
      }
    }
  }
  body = body || {};
  const q = req.query || {};

  const orderReference =
    body.orderReference || body.order || q.orderReference || q.order || '';
  const transactionStatus =
    body.transactionStatus || q.transactionStatus || '';
  const amount = body.amount != null ? body.amount : (q.amount || '');
  const reasonCode = body.reasonCode != null ? body.reasonCode : (q.reasonCode || '');

  console.log('[wfp-return]', {
    method: req.method,
    orderReference: String(orderReference || ''),
    transactionStatus: String(transactionStatus || ''),
    amount: String(amount || ''),
    reasonCode: String(reasonCode || ''),
    referer: req.headers.referer || ''
  });

  // If WFP did not pass status (e.g. direct GET), assume success;
  // otherwise reflect actual status so the cabinet can branch on failures.
  const ok = !transactionStatus || transactionStatus === 'Approved';

  let target;
  if (orderReference) {
    const params = new URLSearchParams();
    params.set('ref', String(orderReference));
    params.set('paid', ok ? '1' : '0');
    if (transactionStatus) params.set('pstatus', String(transactionStatus));
    target = '/order?' + params.toString();
  } else {
    // No reference at all — fall back to homepage success overlay.
    const params = new URLSearchParams();
    params.set('paid', ok ? '1' : '0');
    target = '/?' + params.toString();
  }

  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', target);
  res.end();
};
