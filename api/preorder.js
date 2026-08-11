// api/preorder.js — збір заявок на передзамовлення (ULTERA CORSO)
// v1 · 2026-08-09
// Пише заявку в Supabase (ulhome_preorders) + шле картку адміну в Telegram.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TG_BOT_TOKEN, TG_ADMIN_CHAT_ID

const ALLOWED_ORIGINS = [
  'https://ultera.in.ua',
  'https://www.ultera.in.ua',
  'https://ultera-home.vercel.app'
];

// найпростіший in-memory rate-limit (на інстанс)
const HITS = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const win = 60 * 1000;
  const max = 6;
  const arr = (HITS.get(ip) || []).filter(t => now - t < win);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > max;
}

function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('380')) return '+' + d;
  if (d.length === 10 && d.startsWith('0')) return '+38' + d;
  if (d.length === 9) return '+380' + d;
  return null;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'too_many_requests' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad_json' }); }
  }
  body = body || {};

  const name = String(body.name || '').trim().slice(0, 80);
  const phone = normPhone(body.phone);
  const size = String(body.size || '').replace(/\D/g, '').slice(0, 2) || null;
  const product = String(body.product || 'ULTERA CORSO').slice(0, 80);
  const price = Number(body.price) || 2790;

  if (name.length < 2) return res.status(400).json({ error: 'bad_name' });
  if (!phone) return res.status(400).json({ error: 'bad_phone' });

  const row = {
    name,
    phone,
    size,
    product,
    price,
    page: String(body.page || '').slice(0, 200),
    referrer: String(body.referrer || '').slice(0, 300),
    utm: String(body.utm || '').slice(0, 300),
    ip,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    status: 'new'
  };

  let saved = false;
  let savedId = null;

  // ---- Supabase ----
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/ulhome_preorders`, {
        method: 'POST',
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(row)
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        saved = true;
        savedId = Array.isArray(j) && j[0] ? j[0].id : null;
      } else {
        console.error('supabase preorder insert failed', r.status, await r.text().catch(() => ''));
      }
    } catch (e) {
      console.error('supabase preorder error', e);
    }
  }

  // ---- Telegram ----
  const TG_TOKEN = process.env.TG_BOT_TOKEN;
  const TG_CHAT = process.env.TG_ADMIN_CHAT_ID;
  if (TG_TOKEN && TG_CHAT) {
    const lines = [
      '🟢 <b>Нова заявка — ПЕРЕДЗАМОВЛЕННЯ</b>',
      '',
      `👟 <b>${esc(product)}</b> · ${price} ₴`,
      `👤 ${esc(name)}`,
      `📞 <a href="tel:${esc(phone)}">${esc(phone)}</a>`,
      size ? `📏 Розмір: <b>${esc(size)}</b>` : '📏 Розмір: не вказано',
      row.utm ? `🔗 ${esc(row.utm)}` : null,
      row.referrer ? `↩️ ${esc(row.referrer)}` : null,
      '',
      saved ? `💾 Збережено${savedId ? ' #' + savedId : ''}` : '⚠️ У БД не збереглось — записати вручну!'
    ].filter(Boolean);

    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHAT,
          text: lines.join('\n'),
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
    } catch (e) {
      console.error('tg preorder notify error', e);
    }
  }

  return res.status(200).json({ ok: true, saved });
}
