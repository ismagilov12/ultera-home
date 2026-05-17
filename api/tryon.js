// api/tryon.js — AI Virtual Try-On (gpt-image-1) v2 · 2026-05-17
//
// POST {tshirt_id, view?, model_id?, photo_b64?, gender?, height?, weight?}
//   view: 'front' | 'back' (default 'front')
//   - cache key: (model_id, tshirt_id, view)  OR  (photo_hash, tshirt_id, view)
//
// Зміни v2:
//   • view = 'front' | 'back' — окремі генерації для двох ракурсів
//   • Покращений промпт: точне збереження тіла моделі + точна репродукція принта
//   • Розміри футболки (64×73 см оверсайз L) у промпті — для коректної посадки на тіло
//   • Передаємо до 3 фото-референсів футболки (з ulhome_product_media якщо є)
//   • Опція composing: model preset + user upload разом → AI бере обличчя/риси з upload
//   • Підтримка env OPENAI_IMAGE_MODEL (default 'gpt-image-1', для майбутнього gpt-image-2)
//   • Підтримка env TRYON_QUALITY (default 'medium')
//   • Підтримка env TRYON_TSHIRT_CHEST_CM (default 64), TRYON_TSHIRT_LENGTH_CM (default 73)
//
// Env vars:
//   OPENAI_API_KEY                — обов'язковий
//   OPENAI_IMAGE_MODEL            — default 'gpt-image-1'
//   SUPABASE_URL                  — https://fsihlzzjewhxpogvjapu.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     — service_role JWT
//   TRYON_QUALITY                 — 'low' | 'medium' | 'high' (default 'medium')
//   TRYON_TSHIRT_CHEST_CM         — default 64 (flat width of L oversized)
//   TRYON_TSHIRT_LENGTH_CM        — default 73
//   TRYON_RATE_LIMIT_PER_MIN      — default 5
//   PUBLIC_BASE_URL               — https://ultera-home.vercel.app

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

async function sbSelect(table, query) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const r = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Accept': 'application/json'
    }
  });
  if (!r.ok) return null;
  return await r.json();
}

async function sbSelectOne(table, query) {
  const arr = await sbSelect(table, query + '&limit=1');
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
  return new File([bytes], filename, { type: mime });
}

function absolutizePhoto(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.PUBLIC_BASE_URL || 'https://ultera-home.vercel.app').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

// ---------------- PROMPT BUILDER (v2) ----------------
function buildPromptV2(opts) {
  const {
    view,             // 'front' | 'back'
    gender, build, height, weight,
    colorName, family, hasUploadFace, slug
  } = opts;

  const chestCm  = Number(process.env.TRYON_TSHIRT_CHEST_CM  || 64);
  const lengthCm = Number(process.env.TRYON_TSHIRT_LENGTH_CM || 73);
  const circ     = chestCm * 2;

  // Логіка посадки на основі росту/ваги
  let hemHint = `around mid-hip`;
  if (height) {
    if (height >= 185) hemHint = 'around the hip / upper thigh';
    else if (height >= 175) hemHint = 'mid-hip';
    else if (height >= 165) hemHint = 'at the hip';
    else hemHint = 'upper-hip, slightly longer-looking due to shorter torso';
  }
  let fitHint = 'naturally oversized with relaxed drape';
  if (weight && height) {
    const bmi = weight / Math.pow(height/100, 2);
    if (bmi < 20)      fitHint = 'very loose and roomy, fabric drapes off the shoulders, soft pleats';
    else if (bmi < 25) fitHint = 'naturally oversized, balanced drape, gentle folds';
    else if (bmi < 30) fitHint = 'a relaxed oversized fit, fills the chest more, minimal slack';
    else               fitHint = 'fitted around the chest while still loose at the hem, no stretching';
  }

  const subj = gender === 'female' ? 'woman' : 'man';

  const composing = hasUploadFace
    ? `If a second person reference image is provided in addition to the body-type reference, use it as a guide for FACE, hair and skin tone — but keep the BODY proportions strictly from the body-type reference. Do not invent a different body shape.`
    : '';

  // View-specific інструкції
  const viewBlock = (view === 'back')
    ? `VIEW: BACK
- Rotate the subject 180°: the camera now sees the BACK of the person and the BACK of the t-shirt.
- The model is facing AWAY from the camera. Show the back of the head, the upper back, the back of the t-shirt with its full graphic visible.
- The garment reference image likely shows the BACK of this t-shirt — REPLICATE the graphic on the back of the worn t-shirt EXACTLY:
  • exact same letters, glyphs, numbers (do not invent or rewrite any text — copy character by character)
  • exact same placement, scale, colors, line weights, spacing
  • exact same logo, no extra text added anywhere
- If the reference shows the front of the tee, generate a clean back side appropriate to ULTERA streetwear (plain or minimal small back label, no invented graphic).
- Same background, same lighting, same crop as a front-view photo from the same session.`
    : `VIEW: FRONT
- The subject faces the camera, full body visible.
- Show the FRONT of the t-shirt clearly.
- If the garment reference image clearly shows the FRONT of the tee, REPLICATE that front graphic EXACTLY (letters, logo, placement, colors).
- If the garment reference shows the BACK of the tee (most ULTERA tees are back-print), generate a clean front with a small chest-level mark or a plain front matching the t-shirt color — do NOT mirror the back graphic onto the front.
- NEVER invent text. If you are unsure what the front shows, keep it plain.`;

  return [
    `ULTERA TEES — Virtual Try-On rendering.`,
    ``,
    `═══ PRIMARY SUBJECT (image #1) ═══`,
    `Image #1 is the BODY-TYPE REFERENCE. The new photo must show the SAME person as image #1:`,
    `• preserve EXACT body shape, proportions, height, weight, build, posture, stance`,
    `• preserve EXACT face, hair, skin tone, age (unless overridden — see composing)`,
    `• preserve EXACT lighting direction, background style, ground shadow`,
    `Only the t-shirt may change.`,
    ``,
    composing,
    ``,
    `═══ GARMENT REFERENCE (image #2${opts.refCount && opts.refCount>2 ? ' and #3' : ''}) ═══`,
    `This is the ULTERA TEES oversized t-shirt to apply.`,
    `REPLICATE EXACTLY:`,
    `• Print / graphic / text placement, scale, colors, line weights, character shapes`,
    `• T-shirt color (${colorName || 'as shown'}) and fabric texture`,
    `• Logo position and proportions`,
    `Do NOT redraw, restyle, or paraphrase any text or graphic — copy pixel-faithfully like a high-quality product render.`,
    ``,
    `═══ T-SHIRT PHYSICAL SPECS ═══`,
    `• Oversized fit, drop-shoulder construction, 100% cotton 240 gsm`,
    `• FLAT MEASUREMENTS of size L (single layer, garment laid flat):`,
    `  – chest width: ${chestCm} cm (full circumference ~${circ} cm)`,
    `  – body length: ${lengthCm} cm (collar to hem)`,
    `• On this ${subj} (height ${height || '~178'} cm, weight ${weight || '~75'} kg, build ${build || 'average'}):`,
    `  – hem should fall ${hemHint}`,
    `  – sleeves drop ~5 cm past the natural shoulder seam (drop-shoulder)`,
    `  – the t-shirt should look ${fitHint}`,
    `  – natural fabric folds at the side seams and underarms — soft, not stiff`,
    ``,
    `═══ ${viewBlock}`,
    ``,
    `═══ OUTPUT ═══`,
    `• 1024×1536 portrait`,
    `• photorealistic, magazine-quality editorial fashion photography`,
    `• sharp focus on the t-shirt graphic`,
    `• ABSOLUTELY NO added text, watermark, tag, label, logo other than the original t-shirt print`,
    `• ABSOLUTELY NO altered facial features unless required by composing rule above`,
    ``,
    `Collection: ULTERA TEES${family ? ' ' + family : ''}${slug ? ' · ' + slug : ''}.`
  ].filter(Boolean).join('\n');
}

async function callGptImageEdit({ refImages, prompt, quality, model }) {
  const fd = new FormData();
  fd.append('model', model || 'gpt-image-1');
  fd.append('prompt', prompt);
  fd.append('n', '1');
  fd.append('size', '1024x1536');
  fd.append('quality', quality || 'medium');
  refImages.forEach((b, idx) => {
    fd.append('image[]', bytesToFile(b, 'ref-' + idx + '.png', 'image/png'));
  });

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

// ---------------- HANDLER ----------------
export default async function handler(req, res) {
  const allowed = setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'method not allowed' });
  if (!allowed)                 return res.status(403).json({ error: 'origin not allowed' });

  try {
    if (!process.env.OPENAI_API_KEY)        return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'Supabase env not configured' });
    }

    const ip = getClientIp(req);
    const limit = Number(process.env.TRYON_RATE_LIMIT_PER_MIN || 5);
    const rl = await checkRateLimit(ip, limit);
    if (!rl.allowed) return res.status(429).json({ error: 'too many requests' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      tshirt_id, view: viewIn, model_id, photo_b64,
      gender: genderIn, height: heightIn, weight: weightIn
    } = body;

    const view = (viewIn === 'back') ? 'back' : 'front';

    if (!tshirt_id) return res.status(400).json({ error: 'tshirt_id required' });
    if (!model_id && !photo_b64) {
      return res.status(400).json({ error: 'model_id or photo_b64 required' });
    }

    // === 1. Знайти футболку ===
    const tshirt = await sbSelectOne(
      'ulhome_products',
      `id=eq.${encodeURIComponent(tshirt_id)}&select=id,uid,family,title,color_name,color_hex,photo`
    );
    if (!tshirt) return res.status(404).json({ error: 'tshirt not found' });
    if (!tshirt.photo) return res.status(422).json({ error: 'tshirt has no photo' });

    // === 2. Джерело моделі: preset або upload ===
    let modelMeta = null;
    let modelBytes = null;
    let uploadBytes = null;       // окремий референс обличчя/композиція
    let photoHash = null;
    let cacheKey = null;

    if (model_id) {
      modelMeta = await sbSelectOne(
        'ulhome_tryon_models',
        `id=eq.${encodeURIComponent(model_id)}&select=id,slug,gender,build,height_cm,weight_kg,image_url,published`
      );
      if (!modelMeta || !modelMeta.published) return res.status(404).json({ error: 'model not found' });
      cacheKey = `model_id=eq.${modelMeta.id}&tshirt_id=eq.${tshirt.id}&view=eq.${view}`;
    }

    if (photo_b64) {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(photo_b64);
      if (!m) return res.status(400).json({ error: 'photo_b64 must be data:image/...;base64,...' });
      const ubytes = Buffer.from(m[2], 'base64');
      if (ubytes.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'photo too large (max 8MB)' });
      if (modelMeta) {
        // composing mode: typage = body, upload = face
        uploadBytes = ubytes;
      } else {
        // upload-only mode: upload = body
        modelBytes = ubytes;
        photoHash  = sha256Hex(ubytes);
        cacheKey   = `photo_hash=eq.${photoHash}&tshirt_id=eq.${tshirt.id}&view=eq.${view}`;
      }
    }

    // === 3. Кеш ===
    if (cacheKey) {
      const cached = await sbSelectOne('ulhome_tryon_cache', cacheKey + '&select=id,result_url,view');
      if (cached) {
        return res.status(200).json({
          ok: true, cached: true, view,
          result_url: cached.result_url,
          tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name }
        });
      }
    }

    // === 4. Завантажити байти моделі (preset) ===
    if (modelMeta && !modelBytes) {
      modelBytes = await fetchAsBytes(modelMeta.image_url);
    }

    // === 5. Завантажити фото футболки (1-3 шт із product_media + primary) ===
    const refImages = [modelBytes];
    if (uploadBytes) refImages.push(uploadBytes);

    // Спробуємо знайти кілька фото у ulhome_product_media (front/back/etc)
    const media = await sbSelect(
      'ulhome_product_media',
      `product_id=eq.${encodeURIComponent(tshirt.id)}&select=url,sort_order&order=sort_order.asc&limit=3`
    );
    const teeUrls = [];
    if (Array.isArray(media) && media.length) {
      media.forEach(m => { if (m && m.url && !/size_grid/i.test(m.url)) teeUrls.push(m.url); });
    }
    if (!teeUrls.length) teeUrls.push(tshirt.photo);
    // дедуп
    const seen = new Set();
    const teeUrlsClean = teeUrls.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; }).slice(0, 3);

    for (const u of teeUrlsClean) {
      try {
        const b = await fetchAsBytes(absolutizePhoto(u));
        refImages.push(b);
      } catch (e) {
        console.warn('skip tee photo', u, e.message);
      }
    }
    if (refImages.length < 2) {
      return res.status(422).json({ error: 'no tee photos available' });
    }

    // === 6. Промпт ===
    const prompt = buildPromptV2({
      view,
      gender: modelMeta?.gender || genderIn || 'male',
      build:  modelMeta?.build  || 'average',
      height: modelMeta?.height_cm || heightIn || null,
      weight: modelMeta?.weight_kg || weightIn || null,
      colorName: tshirt.color_name,
      family: tshirt.family,
      slug: tshirt.uid,
      hasUploadFace: !!uploadBytes,
      refCount: refImages.length
    });

    // === 7. Виклик OpenAI ===
    const quality = process.env.TRYON_QUALITY || 'medium';
    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    const resultBytes = await callGptImageEdit({
      refImages, prompt, quality, model
    });

    // === 8. Зберегти результат ===
    const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const tag = modelMeta ? modelMeta.slug : ('user-' + (photoHash || 'anon').slice(0, 12));
    const path = `${tshirt.uid}/${view}-${tag}-${stamp}.png`;
    const resultUrl = await sbStorageUpload('tryon-results', path, resultBytes, 'image/png');

    // === 9. Записати у кеш ===
    if (cacheKey) {
      try {
        await sbInsert('ulhome_tryon_cache', {
          model_id: modelMeta?.id || null,
          photo_hash: photoHash,
          tshirt_uid: tshirt.uid,
          tshirt_id: tshirt.id,
          view,
          result_url: resultUrl,
          prompt: prompt.slice(0, 2000),
          cost_cents: quality === 'high' ? 17 : (quality === 'low' ? 1 : 4)
        });
      } catch (e) {
        // unique race
        const again = await sbSelectOne('ulhome_tryon_cache', cacheKey + '&select=id,result_url');
        if (again) {
          return res.status(200).json({
            ok: true, cached: true, view,
            result_url: again.result_url,
            tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name }
          });
        }
        throw e;
      }
    }

    return res.status(200).json({
      ok: true, cached: false, view,
      result_url: resultUrl,
      tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name }
    });

  } catch (e) {
    console.error('tryon v2 error', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
  maxDuration: 60
};
