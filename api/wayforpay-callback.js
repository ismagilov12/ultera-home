// api/wayforpay-callback.js
// Vercel serverless-функция для приёма Service URL webhook от WayForPay.
// WayForPay шлёт сюда подтверждение оплаты (transactionStatus='Approved')
// или отмены. Мы валидируем подпись, записываем событие в Supabase
// (idempotency) и отдаём ответ, который WayForPay принимает как
// "полученный и принятый к обработке".
//
// SECURITY v3 (2026-04-22):
//   - Строгая проверка подписи: отсутствующая = отказ
//   - Idempotency через Supabase (wayforpay_events)
//   - Логирование в БД (не только console.log)
//   - CORS не выставляем — это server-to-server endpoint
//   - [v3] CAPI Purchase dedup с клиентским Pixel (event_id = orderReference)
//
// Env vars:
//   WAYFORPAY_SECRET          - секретный ключ WayForPay
//   SUPABASE_URL              - https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY - service_role key (только сервер!)
//   FB_PIXEL_ID, FB_CAPI_TOKEN, FB_TEST_EVENT_CODE — опционально, для CAPI
//   (опционально) KEYCRM_TOKEN - для апдейта CRM при Approved

const crypto = require('crypto');
const { sendCAPI } = require('./fb-capi');

const WFP_SIGNATURE_FIELDS = [
  'merchantAccount',
  'orderReference',
  'amount',
  'currency',
  'authCode',
  'cardPan',
  'transactionStatus',
  'reasonCode'
];

// Enrich CAPI event with order data from Supabase (non-blocking).
// Returns { user_data: {...}, custom_data: {...} } or null.
async function lookupOrderForCAPI(orderRef) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || !orderRef) return null;
  try {
    // Search ulhome_orders by notes/number containing the order reference.
    // If not found, fall back to bare amount/currency from the WFP payload.
    const q = encodeURIComponent(orderRef);
    const r = await fetch(
      `${supabaseUrl}/rest/v1/ulhome_orders?select=customer_name,customer_phone,customer_email,items,total&notes=ilike.*${q}*&limit=1`,
      { headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const row = rows[0];
    const nameParts = String(row.customer_name || '').trim().split(/\s+/);
    const fn = nameParts[0] || null;
    const ln = nameParts.slice(1).join(' ') || null;
    const items = Array.isArray(row.items) ? row.items : [];
    return {
      user_data: {
        em: row.customer_email ? [row.customer_email] : undefined,
        ph: row.customer_phone ? [row.customer_phone] : undefined,
        fn, ln
      },
      custom_data: {
        content_ids: items.map(i => String(i.uid || '')).filter(Boolean),
        content_type: 'product',
        value: Number(row.total || 0),
        currency: 'UAH',
        num_items: items.length
      }
    };
  } catch (e) {
    console.warn('[wfp-callback] lookupOrderForCAPI error', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.WAYFORPAY_SECRET;
  if (!secretKey) {
    console.error('[wfp-callback] WAYFORPAY_SECRET missing');
    return res.status(500).json({ error: 'Not configured' });
  }

  // WayForPay шлёт JSON. Поддерживаем и x-www-form-urlencoded на всякий случай.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const {
    merchantAccount,
    orderReference,
    amount,
    currency,
    authCode,
    cardPan,
    transactionStatus,
    reasonCode,
    merchantSignature
  } = body;

  if (!orderReference) {
    return res.status(400).json({ error: 'orderReference missing' });
  }

  // Строгая проверка подписи. БЕЗ signature = отказ.
  const incomingSignatureFields = [
    merchantAccount || '',
    orderReference,
    amount != null ? String(amount) : '',
    currency || '',
    authCode || '',
    cardPan || '',
    transactionStatus || '',
    reasonCode != null ? String(reasonCode) : ''
  ];
  const expected = crypto
    .createHmac('md5', secretKey)
    .update(incomingSignatureFields.join(';'), 'utf8')
    .digest('hex');

  if (!merchantSignature || merchantSignature !== expected) {
    console.warn('[wfp-callback] signature mismatch', {
      orderReference,
      got: merchantSignature || '(missing)',
      expected_prefix: expected.slice(0, 8) + '...'
    });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Idempotency: INSERT в wayforpay_events с unique(order_ref, transaction_status).
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let isFirstEvent = true;
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
  if (supabaseUrl && supabaseKey) {
    try {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/wayforpay_events`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=representation'
        },
        body: JSON.stringify({
          order_ref: orderReference,
          transaction_status: transactionStatus || '',
          amount: amount != null ? Number(amount) : null,
          currency: currency || '',
          auth_code: authCode || '',
          card_pan: cardPan || '',
          reason_code: reasonCode != null ? String(reasonCode) : '',
          raw_payload: body,
          source_ip: clientIp
        })
      });
      if (insertRes.ok) {
        const rows = await insertRes.json().catch(() => []);
        isFirstEvent = Array.isArray(rows) && rows.length > 0;
      } else {
        const errText = await insertRes.text().catch(() => '');
        console.warn('[wfp-callback] supabase insert failed', insertRes.status, errText);
      }
    } catch (e) {
      console.error('[wfp-callback] supabase exception', e.message);
    }
  } else {
    console.warn('[wfp-callback] Supabase env vars missing — idempotency OFF');
  }

  console.log('[wfp-callback]', {
    orderReference,
    transactionStatus,
    amount,
    reasonCode,
    isFirstEvent
  });

  // Side-effects (CAPI Purchase, KeyCRM update) ТОЛЬКО на первом событии.
  if (isFirstEvent && transactionStatus === 'Approved') {
    // --- CAPI Purchase (fire-and-forget; errors logged but not returned to WFP) ---
    try {
      const enriched = await lookupOrderForCAPI(orderReference);
      const ua = req.headers['user-agent'] || '';
      const custom = (enriched && enriched.custom_data) || {
        value: Number(amount || 0),
        currency: currency || 'UAH'
      };
      // If amount differs (e.g. COD prepayment 500 vs real total 1299), trust enriched.total.
      const result = await sendCAPI('Purchase', {
        event_id: orderReference, // dedup with client-side Pixel
        event_source_url: 'https://ultera.in.ua/?paid=1&order=' + encodeURIComponent(orderReference),
        user_data: Object.assign(
          { client_ip_address: clientIp, client_user_agent: ua },
          (enriched && enriched.user_data) || {}
        ),
        custom_data: custom
      });
      console.log('[wfp-callback] CAPI Purchase →', result);
    } catch (e) {
      console.error('[wfp-callback] CAPI exception', e.message);
    }
    // TODO: Phase 2 — обновить ulhome_orders.payment_status = 'paid'
    //       + дёрнуть KeyCRM stage=paid.
  }

  // Ответ для WayForPay (подписанный JSON).
  const responseTime = Math.floor(Date.now() / 1000);
  const status = 'accept';
  const responseSignatureString = [orderReference, status, String(responseTime)].join(';');
  const responseSignature = crypto
    .createHmac('md5', secretKey)
    .update(responseSignatureString, 'utf8')
    .digest('hex');

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    orderReference,
    status,
    time: responseTime,
    signature: responseSignature
  });
};
