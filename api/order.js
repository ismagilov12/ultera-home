// /api/order — proxy from ultera-home frontend → KeyCRM
// Environment variables (set in Vercel → Settings → Environment Variables):
//   KEYCRM_TOKEN      — Bearer token для KeyCRM API (якщо немає — mock-mode, console.log)
//   KEYCRM_SOURCE_ID  — source id замовлення в KeyCRM (default: 1)
//   KEYCRM_PM_CARD    — payment method id для "Оплата карткою"
//   KEYCRM_PM_NP      — payment method id для "Оплата на пошті (наложений платіж)"
//   KEYCRM_DS_NP      — delivery service id для Нової Пошти (default: 1)

export default async function handler(req, res) {
  // CORS (на той випадок якщо викликається з іншого origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ok:false, error:'Invalid JSON'}); }
  }
  if (!body || !body.fio || !body.phone) {
    return res.status(400).json({ ok: false, error: 'Missing fio/phone' });
  }

  // Payment method
  const pmCard = parseInt(process.env.KEYCRM_PM_CARD || '0', 10);
  const pmNp   = parseInt(process.env.KEYCRM_PM_NP   || '0', 10);
  const paymentMethodId = body.payment === 'card' ? pmCard : pmNp;

  // Build KeyCRM payload
  const crmPayload = {
    source_id: parseInt(process.env.KEYCRM_SOURCE_ID || '1', 10),
    manager_comment: `ultera-home · ${body.num || ''}${body.payment === 'np' ? ' · наложка (мін 500₴)' : ' · картка'}`,
    buyer: {
      full_name: body.fio,
      phone: body.phone
    },
    shipping: {
      delivery_service_id: parseInt(process.env.KEYCRM_DS_NP || '1', 10),
      shipping_address_city: body.city || '',
      shipping_address_region: '',
      shipping_address_warehouse: body.wh || '',
      recipient_full_name: body.fio,
      recipient_phone: body.phone
    },
    payments: paymentMethodId ? [{
      payment_method_id: paymentMethodId,
      amount: body.total || 0,
      status: 'not_paid',
      description: body.payment === 'card' ? 'Оплата карткою' : 'Наложений платіж'
    }] : [],
    products: (body.items || []).map(it => ({
      sku: String(it.uid || ''),
      name: it.title + (it.color_name ? ' / ' + it.color_name : '') + (it.size ? ' / р.' + it.size : ''),
      price: parseFloat(it.price) || 0,
      quantity: parseInt(it.qty || 1, 10),
      picture: it.photo || null
    }))
  };

  const token = process.env.KEYCRM_TOKEN;
  if (!token) {
    // MOCK MODE
    console.log('[MOCK] order:', JSON.stringify(crmPayload));
    return res.status(200).json({
      ok: true, mock: true, order_num: body.num,
      message: 'Mock order logged. Set KEYCRM_TOKEN env var in Vercel to enable real integration.'
    });
  }

  // REAL KeyCRM call
  try {
    const r = await fetch('https://openapi.keycrm.app/v1/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(crmPayload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('KeyCRM error', r.status, data);
      return res.status(r.status).json({ ok: false, error: data.message || 'KeyCRM error', details: data });
    }
    return res.status(200).json({ ok: true, order_num: body.num, keycrm_id: data.id || null });
  } catch(e) {
    console.error('KeyCRM exception', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
