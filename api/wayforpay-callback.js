// api/wayforpay-callback.js
// Vercel serverless-функция для приёма Service URL webhook от WayForPay.
// WayForPay шлёт сюда подтверждение оплаты (transactionStatus='Approved')
// или отмены. Мы валидируем подпись, записываем событие в Supabase
// (idempotency) и отдаём ответ, который WayForPay принимает как
// "полученный и принятый к обработке".
//
// SECURITY v2 (2026-04-21):
//   - Строгая проверка подписи: отсутствующая = отказ
//   - Idempotency через Supabase (wayforpay_events)
//   - Логирование в БД (не только console.log)
//   - CORS не выставляем — это server-to-server endpoint
//
// Env vars:
//   WAYFORPAY_SECRET          - секретный ключ WayForPay
//   SUPABASE_URL              - https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY - service_role key (только сервер!)
//   (опционально) KEYCRM_TOKEN - для апдейта CRM при Approved

const crypto = require('crypto');

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
  // Старый код: `if (merchantSignature && merchantSignature !== expected)`
  // пропускал callback без signature — критическая дыра.
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
  // Если запись уже есть — повтор, просто отвечаем "accept" без side-effects.
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let isFirstEvent = true;
  if (supabaseUrl && supabaseKey) {
    try {
      const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
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
        // ignore-duplicates: возвращает [] если дубликат, [row] если новая вставка
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

  // Side-effects (апдейт KeyCRM, списание склада) ТОЛЬКО на первом событии.
  if (isFirstEvent && transactionStatus === 'Approved') {
    // TODO: Phase 2 — обновить ulhome_orders.payment_status = 'paid'
    //       + дёрнуть KeyCRM stage=paid.
    // Сейчас просто логируем факт. Когда ulhome_orders начнёт заполняться
    // из /api/order — добавим UPDATE здесь.
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
