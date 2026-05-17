// api/tryon.js — AI Virtual Try-On (gpt-image-1)
// v1 · 2026-05-17
//
// POST {tshirt_id, model_id?, photo_b64?, gender?, height?, weight?}
//   - если model_id: смотрим кеш (model_id+tshirt_id) → если есть, возвращаем
//   - если photo_b64: считаем sha256, смотрим кеш (photo_hash+tshirt_id)
//   - если кеша нет: тянем фото модели + фото футболки, шлём в gpt-image-1 edits,
//     сохраняем в Supabase Storage bucket tryon-results, пишем запись в ulhome_tryon_cache
//
// Env vars:
//   OPENAI_API_KEY                — ключ OpenAI (обязателен)
//   SUPABASE_URL                  — https://fsihlzzjewhxpogvjapu.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     — service_role JWT
//   TRYON_QUALITY                 — 'low' | 'medium' | 'high' (default 'medium')
//   TRYON_RATE_LIMIT_PER_MIN      — лимит на IP/мин (default 5)
//   PUBLIC_BASE_URL               — https://ultera-home.vercel.app (для абсолютных URL к /tshirts-cards/...)

import crypto from 'node:crypto';

const ALLOWED_ORIGINS_EXACT = new Set([
  'https://ultera.in.ua',
  'https://www.ultera.in.ua',
  'https://ultera-home.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
]);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const isAllowed =
    ALLOWED_ORIGINS_EXACT.has(origin) ||
    origin.endsWith('.vercel.app');
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return isAllowed;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

async function checkRateLimit(ip, limit) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { allowed: true, skipped: true };
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/check_and_increment_rate_limit`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_ip: ip, p_endpoint: 'tryon', p_limit: limit })
    });
    if (!r.ok) return { allowed: true, skipped: true };
    return await r.json();
  } catch (_e) {
    return { allowed: true, skipped: true };
  }
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function sbSelectOne(table, query) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?${query}&limit=1`;
  const r = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Accept': 'application/json'
    }
  });
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function sbInsert(table, payload) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Supabase insert failed: ' + r.status + ' ' + txt);
  }
  const arr = await r.json();
  return Array.isArray(arr) ? arr[0] : arr;
}

async function sbStorageUpload(bucket, path, bytes, contentType) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true'
    },
    body: bytes
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Supabase storage upload failed: ' + r.status + ' ' + txt);
  }
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

async function fetchAsBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch ' + url + ' → ' + r.status);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

function bytesToFile(bytes, filename, mime) {
  // File polyfill для node fetch FormData
  return new File([bytes], filename, { type: mime });
}

// Resolve относительные пути типа /tshirts-cards/ROUTE-05/01.webp → абсолютные
function absolutizePhoto(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.PUBLIC_BASE_URL || 'https://ultera-home.vercel.app').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

function buildPrompt(opts) {
  const { gender, build, height, weight, colorName, family } = opts;
  const subj = gender === 'female' ? 'woman' : 'man';
  const lines = [
    `Photorealistic full-body editorial fashion photo of the same ${subj} from the first image,`,
    `now wearing the t-shirt from the second image.`,
    `The t-shirt is an oversized fit, drop-shoulder, 100% cotton 240gsm,`,
    `color: ${colorName || 'as-is'}.`,
    `Keep the print, logo and graphic on the t-shirt EXACTLY as in the second image — same placement, scale, colors, no distortion.`,
    `Person facing camera, neutral confident pose, hands relaxed, looking slightly off-camera.`,
    `Background: clean studio cyclorama, soft warm beige (#f1ede4) gradient, subtle ground shadow.`,
    `Soft natural daylight from front-left, gentle rim light, no harsh shadows.`,
    `Realistic fabric drape and folds, natural skin texture, sharp focus on the t-shirt graphic.`,
    `Crop: full body from above the head to mid-thigh, centered.`,
    `Style: ULTERA streetwear lookbook, premium, magazine quality.`,
    `Do NOT add any text, watermark, logo (except the original print), tag or label.`
  ];
  if (build)  lines.push(`Body build: ${build}.`);
  if (height) lines.push(`Approximate height: ${height} cm.`);
  if (weight) lines.push(`Approximate weight: ${weight} kg.`);
  if (family) lines.push(`Collection: ULTERA TEES ${family}.`);
  return lines.join(' ');
}

async function callGptImageEdit({ modelImageBytes, tshirtImageBytes, prompt, quality }) {
  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  fd.append('prompt', prompt);
  fd.append('n', '1');
  fd.append('size', '1024x1536'); // портретная композиция под одежду
  fd.append('quality', quality || 'medium');
  fd.append('image[]', bytesToFile(modelImageBytes, 'model.png', 'image/png'));
  fd.append('image[]', bytesToFile(tshirtImageBytes, 'tshirt.png', 'image/png'));

  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
    },
    body: fd
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('OpenAI edits failed: ' + r.status + ' ' + txt.slice(0, 400));
  }
  const j = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: no image returned');
  return Buffer.from(b64, 'base64');
}

export default async function handler(req, res) {
  const allowed = setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'method not allowed' });
  if (!allowed)                 return res.status(403).json({ error: 'origin not allowed' });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'Supabase env not configured' });
    }

    const ip = getClientIp(req);
    const limit = Number(process.env.TRYON_RATE_LIMIT_PER_MIN || 5);
    const rl = await checkRateLimit(ip, limit);
    if (!rl.allowed) return res.status(429).json({ error: 'too many requests' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { tshirt_id, model_id, photo_b64, gender, height, weight } = body;

    if (!tshirt_id) return res.status(400).json({ error: 'tshirt_id required' });
    if (!model_id && !photo_b64) {
      return res.status(400).json({ error: 'model_id or photo_b64 required' });
    }

    // === 1. Найти товар ===
    const tshirt = await sbSelectOne(
      'ulhome_products',
      `id=eq.${encodeURIComponent(tshirt_id)}&select=id,uid,family,title,color_name,color_hex,photo`
    );
    if (!tshirt) return res.status(404).json({ error: 'tshirt not found' });
    if (!tshirt.photo) return res.status(422).json({ error: 'tshirt has no photo' });

    // === 2. Источник фото человека: preset или upload ===
    let modelMeta = null;
    let modelBytes = null;
    let photoHash = null;
    let cacheKey = null;

    if (model_id) {
      modelMeta = await sbSelectOne(
        'ulhome_tryon_models',
        `id=eq.${encodeURIComponent(model_id)}&select=id,slug,gender,build,height_cm,weight_kg,image_url,published`
      );
      if (!modelMeta || !modelMeta.published) {
        return res.status(404).json({ error: 'model not found' });
      }
      cacheKey = `model_id=eq.${modelMeta.id}&tshirt_id=eq.${tshirt.id}`;
    } else {
      // user upload
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(photo_b64);
      if (!m) return res.status(400).json({ error: 'photo_b64 must be data:image/...;base64,...' });
      modelBytes = Buffer.from(m[2], 'base64');
      if (modelBytes.length > 8 * 1024 * 1024) {
        return res.status(413).json({ error: 'photo too large (max 8MB)' });
      }
      photoHash = sha256Hex(modelBytes);
      cacheKey = `photo_hash=eq.${photoHash}&tshirt_id=eq.${tshirt.id}`;
    }

    // === 3. Проверить кеш ===
    const cached = await sbSelectOne('ulhome_tryon_cache', cacheKey + '&select=id,result_url,created_at');
    if (cached) {
      return res.status(200).json({
        ok: true,
        cached: true,
        result_url: cached.result_url,
        tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name }
      });
    }

    // === 4. Загрузить байты модели (если preset) и футболки ===
    if (modelMeta && !modelBytes) {
      modelBytes = await fetchAsBytes(modelMeta.image_url);
    }
    const tshirtAbs = absolutizePhoto(tshirt.photo);
    const tshirtBytes = await fetchAsBytes(tshirtAbs);

    // === 5. Сгенерить prompt и вызвать gpt-image-1 ===
    const prompt = buildPrompt({
      gender: modelMeta?.gender || gender || 'male',
      build:  modelMeta?.build  || 'average',
      height: modelMeta?.height_cm || height || null,
      weight: modelMeta?.weight_kg || weight || null,
      colorName: tshirt.color_name,
      family: tshirt.family
    });
    const quality = process.env.TRYON_QUALITY || 'medium';
    const resultBytes = await callGptImageEdit({
      modelImageBytes: modelBytes,
      tshirtImageBytes: tshirtBytes,
      prompt,
      quality
    });

    // === 6. Загрузить результат в Supabase Storage ===
    const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const tag = modelMeta ? modelMeta.slug : ('user-' + photoHash.slice(0, 12));
    const path = `${tshirt.uid}/${tag}-${stamp}.png`;
    const resultUrl = await sbStorageUpload('tryon-results', path, resultBytes, 'image/png');

    // === 7. Записать в кеш ===
    try {
      await sbInsert('ulhome_tryon_cache', {
        model_id: modelMeta?.id || null,
        photo_hash: photoHash,
        tshirt_uid: tshirt.uid,
        tshirt_id: tshirt.id,
        result_url: resultUrl,
        prompt: prompt.slice(0, 2000),
        cost_cents: quality === 'high' ? 17 : (quality === 'low' ? 1 : 4)
      });
    } catch (e) {
      // unique race: подтянуть существующее
      const again = await sbSelectOne('ulhome_tryon_cache', cacheKey + '&select=id,result_url');
      if (again) {
        return res.status(200).json({
          ok: true, cached: true, result_url: again.result_url,
          tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name }
        });
      }
      // иначе пробрасываем
      throw e;
    }

    return res.status(200).json({
      ok: true,
      cached: false,
      result_url: resultUrl,
      tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name }
    });

  } catch (e) {
    console.error('tryon error', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
  maxDuration: 60
};
