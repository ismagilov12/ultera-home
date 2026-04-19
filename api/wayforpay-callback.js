// api/wayforpay-callback.js
// Vercel serverless-функция для приёма Service URL webhook от WayForPay.
// WayForPay шлёт сюда подтверждение оплаты (transactionStatus='Approved')
// или отмены. Мы валидируем подпись и отдаём ответ, который WayForPay
// принимает как "полученный и принятый к обработке".
//
// Опционально здесь же можно дёрнуть KeyCRM API (stage=final/paid)
// чтобы пометить заказ оплаченным в CRM.
//
// Env vars:
//   WAYFORPAY_SECRET    - тот же секретный ключ
//   (опционально) KEYCRM_TOKEN, KEYCRM_ORDER_STATUS_PAID_ID - для апдейта CRM

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.WAYFORPAY_SECRET;
  if (!secretKey) {
    console.error('WAYFORPAY_SECRET missing');
    return res.status(500).json({ error: 'Not configured' });
  }

  // WayForPay шлёт JSON. На всякий случай поддерживаем и x-www-form-urlencoded.
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

  // Валидируем входящую подпись от WayForPay:
  // merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode
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

  if (merchantSignature && merchantSignature !== expected) {
    console.warn('WayForPay callback signature mismatch', {
      orderReference,
      got: merchantSignature,
      expected
    });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Логируем что пришло (в продакшне можно отключить / писать в БД)
  console.log('WayForPay callback', {
    orderReference,
    transactionStatus,
    amount,
    reasonCode
  });

  // TODO: опционально дёрнуть KeyCRM чтобы пометить заказ оплаченным.
  // if (transactionStatus === 'Approved') {
  //   await fetch('https://openapi.keycrm.app/v1/order/...', { ... });
  // }

  // Отдаём ответ, который WayForPay ждёт (JSON с подписью своего ответа).
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
