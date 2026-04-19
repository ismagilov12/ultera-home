// api/wayforpay.js
// Vercel serverless-функция для создания платежа в WayForPay.
// Вызывается с фронта после успешного создания заказа в KeyCRM.
// Возвращает JSON с полями формы для submit на secure.wayforpay.com/pay
// (включая HMAC-MD5 подпись).
//
// Env vars (Vercel Settings -> Environment Variables):
//   WAYFORPAY_MERCHANT  - логин продавца, напр. "ultera_tech"
//   WAYFORPAY_SECRET    - секретный ключ из ЛК WayForPay
//   WAYFORPAY_DOMAIN    - домен сайта, напр. "ultera.in.ua"
//                        (должен быть заявлен в ЛК WayForPay)

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  // CORS для собственного домена
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const merchantAccount = process.env.WAYFORPAY_MERCHANT;
  const secretKey = process.env.WAYFORPAY_SECRET;
  const merchantDomainName = process.env.WAYFORPAY_DOMAIN || 'ultera.in.ua';

  if (!merchantAccount || !secretKey) {
    console.error('WayForPay env vars missing');
    return res.status(500).json({
      error: 'Payment system is not configured',
      hint: 'Set WAYFORPAY_MERCHANT and WAYFORPAY_SECRET in Vercel env vars'
    });
  }

  // Разбор тела
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  body = body || {};

  const {
    orderReference,
    amount,
    products,
    clientFirstName,
    clientLastName,
    clientEmail,
    clientPhone,
    paymentMode
  } = body;

  // Валидация
  if (!orderReference || typeof orderReference !== 'string') {
    return res.status(400).json({ error: 'orderReference is required' });
  }
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'products must be a non-empty array' });
  }
  for (const p of products) {
    if (!p.name || !p.count || p.price == null) {
      return res.status(400).json({ error: 'each product needs {name, count, price}' });
    }
  }

  const orderDate = Math.floor(Date.now() / 1000);
  const currency = 'UAH';

  const productName = products.map(p => String(p.name));
  const productCount = products.map(p => String(Number(p.count)));
  const productPrice = products.map(p => Number(p.price).toFixed(2));
  const amountStr = Number(amount).toFixed(2);

  // Порядок полей для подписи согласно спецификации WayForPay:
  // merchantAccount;merchantDomainName;orderReference;orderDate;amount;currency;
  // productName[0];productName[1];...;productCount[0];...;productPrice[0];...
  const signatureFields = [
    merchantAccount,
    merchantDomainName,
    orderReference,
    String(orderDate),
    amountStr,
    currency,
    ...productName,
    ...productCount,
    ...productPrice
  ];
  const signatureString = signatureFields.join(';');
  const merchantSignature = crypto
    .createHmac('md5', secretKey)
    .update(signatureString, 'utf8')
    .digest('hex');

  // URL возврата после оплаты и URL для webhook'ов
  const base = `https://${merchantDomainName}`;
  const returnUrl = `${base}/?paid=1&order=${encodeURIComponent(orderReference)}`;
  const serviceUrl = `${base}/api/wayforpay-callback`;

  // Набор платёжных систем — для "оплата частями" через моно/а-банк
  // нужно добавить paymentSystems = 'card;privat24;masterPass;visaCheckout;qrCode;bankCasa;invoiceTarget;portmone;account'.
  // По умолчанию отдаём полный набор.
  const paymentSystems = 'card;privat24;masterPass;visaCheckout;qrCode;bankCasa;invoiceTarget;portmone;account';

  const formData = {
    merchantAccount,
    merchantAuthType: 'SimpleSignature',
    merchantDomainName,
    merchantSignature,
    orderReference,
    orderDate: String(orderDate),
    amount: amountStr,
    currency,
    productName,
    productCount,
    productPrice,
    clientFirstName: clientFirstName || '',
    clientLastName: clientLastName || '',
    clientEmail: clientEmail || '',
    clientPhone: clientPhone || '',
    returnUrl,
    serviceUrl,
    language: 'UA',
    paymentSystems
  };

  // Отдаём JSON + готовый HTML формы (на случай если фронт хочет просто
  // получить готовый HTML и сделать document.write).
  const formHtml = buildAutoSubmitForm(formData);

  return res.status(200).json({
    ok: true,
    paymentUrl: 'https://secure.wayforpay.com/pay',
    formData,
    formHtml
  });
};

function buildAutoSubmitForm(data) {
  const inputs = [];
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      for (const v of val) {
        inputs.push(`<input type="hidden" name="${esc(key)}[]" value="${esc(v)}">`);
      }
    } else {
      inputs.push(`<input type="hidden" name="${esc(key)}" value="${esc(val)}">`);
    }
  }
  return `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><title>Переадресація на оплату...</title><style>body{font-family:-apple-system,Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0c0c0c;color:#fff}.box{text-align:center;padding:40px}.spinner{width:40px;height:40px;border:3px solid #333;border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spinner"></div><div>Переадресація на захищену сторінку оплати WayForPay...</div></div><form id="wfp" method="POST" action="https://secure.wayforpay.com/pay" accept-charset="utf-8">${inputs.join('')}</form><script>document.getElementById('wfp').submit();</script></body></html>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
