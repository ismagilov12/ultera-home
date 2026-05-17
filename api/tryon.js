// api/tryon.js — AI Virtual Try-On (gpt-image-1) v7 · 2026-05-17
//
// FINAL FIX: image[] array syntax + WebP MIME detection
// Спрощений промпт. 2 сценарії:
//   A) З фото клієнта (photo_b64) → use it as the person + override description with their height/weight
//   B) Без фото → опис тіла з типажа (gender/build/height/weight)
// Always diptych output 1536x1024 (front+back).

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
  const isAllowed = ALLOWED_ORIGINS_EXACT.has(origin) || origin.endsWith('.vercel.app');
  if (isAllowed) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
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
  const sbu = process.env.SUPABASE_URL, sbk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbu || !sbk) return { allowed: true, skipped: true };
  try {
    const r = await fetch(sbu + '/rest/v1/rpc/check_and_increment_rate_limit', {
      method: 'POST',
      headers: { 'apikey': sbk, 'Authorization': 'Bearer ' + sbk, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ip: ip, p_endpoint: 'tryon', p_limit: limit })
    });
    if (!r.ok) return { allowed: true, skipped: true };
    return await r.json();
  } catch { return { allowed: true, skipped: true }; }
}
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function sbSelect(table, query) {
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
    headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
               'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Accept': 'application/json' }
  });
  if (!r.ok) return null;
  return await r.json();
}
async function sbSelectOne(table, query) {
  const arr = await sbSelect(table, query + '&limit=1');
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}
async function sbInsert(table, payload) {
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
               'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
               'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) { const txt = await r.text(); throw new Error('Supabase insert: ' + r.status + ' ' + txt); }
  return await r.json();
}
async function sbStorageUpload(bucket, path, bytes, contentType) {
  const r = await fetch(process.env.SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
               'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes
  });
  if (!r.ok) { const txt = await r.text(); throw new Error('Storage upload: ' + r.status + ' ' + txt); }
  return process.env.SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path;
}
async function fetchAsBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch ' + url + ' -> ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
function bytesToFile(bytes, filename, mime) { return new File([bytes], filename, { type: mime }); }

function detectMime(bytes) {
  if (!bytes || bytes.length < 12) return { mime: 'image/png', ext: 'png' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { mime: 'image/png', ext: 'png' };
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return { mime: 'image/webp', ext: 'webp' };
  return { mime: 'image/png', ext: 'png' };
}

function absolutizePhoto(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.PUBLIC_BASE_URL || 'https://ultera-home.vercel.app').replace(/\/+$/, '');
  return base + (path.startsWith('/') ? path : '/' + path);
}

// ---------- SIMPLE PROMPT ----------
// 2 сценарії: A) є фото юзера; B) тільки опис + типаж
function buildPrompt({ scenario, gender, build, height, weight, colorName, family, slug }) {
  const subj = gender === 'female' ? 'woman' : 'man';

  const buildHints = {
    slim:    'lean, narrow shoulders, slim waist',
    average: 'balanced proportions, moderate chest and waist',
    athletic:'broad shoulders, defined chest, narrow waist, toned',
    plus:    'fuller build, wider torso, soft body shape'
  };
  const buildDesc = buildHints[build] || 'average proportions';

  // BMI hint
  let fit = 'naturally oversized, balanced drape';
  if (height && weight) {
    const bmi = weight / Math.pow(height/100, 2);
    if (bmi < 20)      fit = 'very loose, fabric drapes off shoulders, soft pleats';
    else if (bmi < 25) fit = 'oversized with relaxed drape';
    else if (bmi < 30) fit = 'relaxed oversized fit, fills chest more';
    else               fit = 'fitted at chest, loose at hem, no stretching';
  }

  if (scenario === 'A') {
    // З фото клієнта
    return [
      'ULTERA TEES virtual try-on.',
      '',
      'INPUT IMAGES:',
      '#1 — the customer photo (the PERSON to dress).',
      '#2 (and #3 if present) — the t-shirt references (front and/or back of the garment).',
      '',
      'TASK: Make ONE diptych image (1536x1024 landscape):',
      '• LEFT HALF: the SAME PERSON from image #1, facing camera, wearing the t-shirt from the references, FRONT view.',
      '• RIGHT HALF: the SAME PERSON, back to camera, BACK view of the t-shirt.',
      '',
      'PERSON: Preserve EXACTLY the face, hair, skin tone, ethnicity from image #1.',
      'Adjust body proportions to match: height ' + (height || 178) + ' cm, weight ' + (weight || 75) + ' kg, build "' + build + '" (' + buildDesc + ').',
      'Pose: standing straight, weight slightly on one leg, hands relaxed.',
      '',
      'T-SHIRT: ULTERA TEES oversized L (chest 64cm flat / circ 128cm, length 73cm, 240gsm cotton, drop-shoulder).',
      'Color: ' + (colorName || 'as shown') + '. Fit: ' + fit + '.',
      'REPLICATE the print/graphic/text EXACTLY as in references (same letters, glyphs, placement, colors — copy character by character, do NOT invent or rewrite text).',
      '',
      'BACKGROUND: clean studio cyclorama, warm beige (#f1ede4 to #ebe6d9), soft daylight from front-left, gentle ground shadow.',
      'STYLE: photorealistic, magazine-quality editorial fashion. NO added text, no watermarks, no "FRONT"/"BACK" labels.',
      '',
      'Collection: ULTERA TEES' + (family ? ' ' + family : '') + (slug ? ' · ' + slug : '') + '.'
    ].join('\n');
  }

  // B — без фото юзера
  return [
    'ULTERA TEES virtual try-on.',
    '',
    'INPUT IMAGES: the t-shirt references (front and/or back of the garment).',
    '',
    'TASK: Make ONE diptych image (1536x1024 landscape):',
    '• LEFT HALF: a model facing camera, FRONT view of the t-shirt.',
    '• RIGHT HALF: same model with back to camera, BACK view of the t-shirt.',
    '',
    'MODEL (generate photorealistically):',
    '• ' + subj + ', height ' + (height || 178) + ' cm, weight ' + (weight || 75) + ' kg',
    '• body type: ' + build + ' (' + buildDesc + ')',
    '• Caucasian, age 22-30, neutral confident expression, calm gaze slightly off-camera',
    '• short natural hair (women: feminine medium-length hair), minimal makeup',
    '• standing straight, weight slightly on one leg, hands relaxed',
    '',
    'T-SHIRT: ULTERA TEES oversized L (chest 64cm flat / circ 128cm, length 73cm, 240gsm cotton, drop-shoulder).',
    'Color: ' + (colorName || 'as shown') + '. Fit: ' + fit + '.',
    'REPLICATE the print/graphic/text EXACTLY as in references (same letters, glyphs, placement, colors — copy character by character, do NOT invent or rewrite text).',
    '',
    'BACKGROUND: clean studio cyclorama, warm beige (#f1ede4 to #ebe6d9), soft daylight from front-left, gentle ground shadow.',
    'STYLE: photorealistic, magazine-quality editorial fashion. NO added text, no watermarks, no "FRONT"/"BACK" labels.',
    '',
    'Collection: ULTERA TEES' + (family ? ' ' + family : '') + (slug ? ' · ' + slug : '') + '.'
  ].join('\n');
}

async function callGptImageEdit({ refImages, prompt, quality, model, timeoutMs }) {
  const fd = new FormData();
  fd.append('model', model || 'gpt-image-1');
  fd.append('prompt', prompt);
  fd.append('n', '1');
  fd.append('size', '1536x1024');
  fd.append('quality', quality || 'medium');
  // image[] — array syntax as required by OpenAI for multiple input images
  refImages.forEach((b, idx) => {
    const det = detectMime(b);
    console.log('[tryon] ref ' + idx + ': ' + b.length + ' bytes ' + det.mime);
    fd.append('image[]', bytesToFile(b, 'ref-' + idx + '.' + det.ext, det.mime));
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 240000);
  try {
    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
      body: fd,
      signal: ctrl.signal
    });
    if (!r.ok) {
      const ct = r.headers.get('content-type') || '';
      const raw = await r.text();
      let detail = raw.slice(0, 400);
      if (ct.includes('application/json')) {
        try { const j = JSON.parse(raw); detail = (j && j.error && j.error.message) || detail; } catch {}
      }
      throw new Error('OpenAI edits ' + r.status + ': ' + detail);
    }
    const j = await r.json();
    const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
    if (!b64) throw new Error('OpenAI: no image returned');
    return Buffer.from(b64, 'base64');
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const allowed = setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'method not allowed' });
  if (!allowed)                 return res.status(403).json({ error: 'origin not allowed' });

  const t0 = Date.now();
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'Supabase env not configured' });
    }

    const ip = getClientIp(req);
    const rl = await checkRateLimit(ip, Number(process.env.TRYON_RATE_LIMIT_PER_MIN || 5));
    if (!rl.allowed) return res.status(429).json({ error: 'too many requests' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { tshirt_id, model_id, photo_b64, gender: genderIn, height: heightIn, weight: weightIn } = body;
    const view = 'combined';

    if (!tshirt_id) return res.status(400).json({ error: 'tshirt_id required' });
    if (!model_id && !photo_b64) return res.status(400).json({ error: 'model_id or photo_b64 required' });

    console.log('[tryon] start tshirt=' + tshirt_id + ' model=' + (model_id || 'upload'));

    const tshirt = await sbSelectOne('ulhome_products',
      'id=eq.' + encodeURIComponent(tshirt_id) + '&select=id,uid,family,title,color_name,color_hex,photo');
    if (!tshirt) return res.status(404).json({ error: 'tshirt not found' });
    if (!tshirt.photo) return res.status(422).json({ error: 'tshirt has no photo' });

    let modelMeta = null, uploadBytes = null, photoHash = null, cacheKey = null;
    if (model_id) {
      modelMeta = await sbSelectOne('ulhome_tryon_models',
        'id=eq.' + encodeURIComponent(model_id) + '&select=id,slug,gender,build,height_cm,weight_kg,image_url,published,is_icon');
      if (!modelMeta || !modelMeta.published) return res.status(404).json({ error: 'model not found' });
      cacheKey = 'model_id=eq.' + modelMeta.id + '&tshirt_id=eq.' + tshirt.id + '&view=eq.' + view;
      console.log('[tryon] model: ' + modelMeta.slug + ' is_icon=' + modelMeta.is_icon);
    }
    if (photo_b64) {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(photo_b64);
      if (!m) return res.status(400).json({ error: 'photo_b64 must be data:image/...;base64,...' });
      uploadBytes = Buffer.from(m[2], 'base64');
      if (uploadBytes.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'photo too large (max 8MB)' });
      if (!modelMeta) { photoHash = sha256Hex(uploadBytes); cacheKey = 'photo_hash=eq.' + photoHash + '&tshirt_id=eq.' + tshirt.id + '&view=eq.' + view; }
    }

    // Cache check (тільки коли без upload — інакше упустимо унікальне)
    if (cacheKey && !uploadBytes) {
      const cached = await sbSelectOne('ulhome_tryon_cache', cacheKey + '&select=id,result_url,view');
      if (cached) {
        console.log('[tryon] cache HIT');
        return res.status(200).json({ ok: true, cached: true, view, result_url: cached.result_url,
          tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name } });
      }
    }

    // Збираємо refs
    const refImages = [];
    let scenario = 'B'; // default — без фото юзера
    if (uploadBytes) {
      refImages.push(uploadBytes);
      scenario = 'A';
    }

    // Tee photos: 1-2 з product_media або primary
    const media = await sbSelect('ulhome_product_media',
      'product_id=eq.' + encodeURIComponent(tshirt.id) + '&select=url,sort_order&order=sort_order.asc&limit=4');
    const teeUrls = [];
    if (Array.isArray(media)) media.forEach(m => { if (m && m.url && !/size_grid/i.test(m.url)) teeUrls.push(m.url); });
    if (!teeUrls.length && tshirt.photo) teeUrls.push(tshirt.photo);
    const seen = new Set();
    const teeUrlsClean = teeUrls.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; }).slice(0, 2);
    console.log('[tryon] tee urls: ' + teeUrlsClean.join(', '));
    for (const u of teeUrlsClean) {
      try { refImages.push(await fetchAsBytes(absolutizePhoto(u))); }
      catch (e) { console.warn('skip tee photo', u, e.message); }
    }
    if (!refImages.length) return res.status(422).json({ error: 'no images to send' });

    // Prompt
    const gender = (modelMeta && modelMeta.gender) || genderIn || 'male';
    const build  = (modelMeta && modelMeta.build)  || 'average';
    const height = (modelMeta && modelMeta.height_cm) || Number(heightIn) || null;
    const weight = (modelMeta && modelMeta.weight_kg) || Number(weightIn) || null;

    const prompt = buildPrompt({
      scenario, gender, build, height, weight,
      colorName: tshirt.color_name, family: tshirt.family, slug: tshirt.uid
    });

    const quality = process.env.TRYON_QUALITY || 'medium';
    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    console.log('[tryon] OpenAI: scenario=' + scenario + ' refs=' + refImages.length + ' quality=' + quality + ' (t+' + (Date.now()-t0) + 'ms)');
    const resultBytes = await callGptImageEdit({ refImages, prompt, quality, model, timeoutMs: 240000 });
    console.log('[tryon] OpenAI done: ' + resultBytes.length + ' bytes (t+' + (Date.now()-t0) + 'ms)');

    // Save
    const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const tag = modelMeta ? modelMeta.slug : ('user-' + (photoHash || 'anon').slice(0, 12));
    const path = tshirt.uid + '/combined-' + tag + '-' + stamp + '.png';
    const resultUrl = await sbStorageUpload('tryon-results', path, resultBytes, 'image/png');

    // Cache
    if (cacheKey && !uploadBytes) {
      try {
        await sbInsert('ulhome_tryon_cache', {
          model_id: (modelMeta && modelMeta.id) || null,
          photo_hash: photoHash,
          tshirt_uid: tshirt.uid,
          tshirt_id: tshirt.id,
          view,
          result_url: resultUrl,
          prompt: prompt.slice(0, 2000),
          cost_cents: quality === 'high' ? 17 : (quality === 'low' ? 1 : 4)
        });
      } catch (e) {
        const again = await sbSelectOne('ulhome_tryon_cache', cacheKey + '&select=id,result_url');
        if (again) return res.status(200).json({ ok: true, cached: true, view, result_url: again.result_url,
          tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name } });
        throw e;
      }
    }

    console.log('[tryon] DONE (total ' + (Date.now()-t0) + 'ms)');
    return res.status(200).json({ ok: true, cached: false, view, result_url: resultUrl,
      tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name } });

  } catch (e) {
    console.error('[tryon] ERROR (t+' + (Date.now()-t0) + 'ms):', (e && e.message) || e);
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
  maxDuration: 300
};
