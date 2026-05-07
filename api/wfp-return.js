// api/wfp-return.js
// User-facing return endpoint after WayForPay payment.
// WFP redirects the customer's browser via POST (default) or GET to this URL
// with a form payload (orderReference, transactionStatus, amount, etc.).
// We accept BOTH methods, log the hit for diagnostics, and 302-redirect to
// "/?paid=1&order=..." so the static homepage can render the success overlay.
//
// Why this file exists:
//   Previously returnUrl pointed at "/?paid=1&order=...", but Vercel's static
//   handler returns 405 to POST on a static file, and customers saw
//   "405 Method Not Allowed" right after paying.

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

  const params = new URLSearchParams();
  if (orderReference) params.set('order', String(orderReference));
  // If WFP did not pass status (e.g. direct GET), assume success;
  // otherwise reflect actual status so frontend can branch on failures.
  const ok = !transactionStatus || transactionStatus === 'Approved';
  params.set('paid', ok ? '1' : '0');
  if (transactionStatus) params.set('status', String(transactionStatus));

  const target = '/?' + params.toString();

  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', target);
  res.end();
};
