// api/tryon.js — AI Virtual Try-On (gpt-image-1) v5 · 2026-05-17
//
// Зміни v5:
//   • Виправлено OpenAI edits: поле 'image' (не 'image[]') — правильна назва FormData
//   • MIME detection з magic bytes → правильні content-type і extension
//     (WebP-фото від Tilda тепер передаються коректно як image/webp)
// v4 + diptych: підтримка is_icon, front+back в одному 1536x1024.

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
    const r = await fetch(`${sbu}/rest/v1/rpc/check_and_increment_rate_limit`, {
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
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const r = await fetch(url, {
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
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
               'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
               'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) { const txt = await r.text(); throw new Error('Supabase insert: ' + r.status + ' ' + txt); }
  const arr = await r.json();
  return Array.isArray(arr) ? arr[0] : arr;
}
async function sbStorageUpload(bucket, path, bytes, contentType) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
               'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes
  });
  if (!r.ok) { const txt = await r.text(); throw new Error('Storage upload: ' + r.status + ' ' + txt); }
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
async function fetchAsBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch ' + url + ' → ' + r.status);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}
function bytesToFile(bytes, filename, mime) { return new File([bytes], filename, { type: mime }); }

// Magic-byte detection — щоб правильно передавати content-type у multipart
function detectMime(bytes) {
  if (!bytes || bytes.length < 12) return { mime: 'image/png', ext: 'png' };
  // PNG  89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  // JPEG FF D8
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return { mime: 'image/jpeg', ext: 'jpg' };
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { mime: 'image/gif', ext: 'gif' };
  // WebP: "RIFF" .... "WEBP"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return { mime: 'image/png', ext: 'png' };
}
function absolutizePhoto(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.PUBLIC_BASE_URL || 'https://ultera-home.vercel.app').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

// ---------- PROMPT ----------
function buildPromptDiptych(opts) {
  const { gender, build, height, weight, colorName, family, slug, hasUploadFace, teeRefCount, hasModelImage } = opts;

  const chest  = Number(process.env.TRYON_TSHIRT_CHEST_CM  || 64);
  const length = Number(process.env.TRYON_TSHIRT_LENGTH_CM || 73);
  const circ   = chest * 2;

  let hem = 'around mid-hip';
  if (height) {
    if (height >= 185) hem = 'around the hip / upper thigh';
    else if (height >= 175) hem = 'mid-hip';
    else if (height >= 165) hem = 'at the hip';
    else hem = 'upper-hip';
  }
  let fit = 'naturally oversized with relaxed drape';
  if (height && weight) {
    const bmi = weight / Math.pow(height / 100, 2);
    if (bmi < 20)      fit = 'very loose and roomy, fabric drapes off the shoulders, soft pleats';
    else if (bmi < 25) fit = 'naturally oversized, balanced drape, gentle folds';
    else if (bmi < 30) fit = 'a relaxed oversized fit, fills the chest more, minimal slack';
    else               fit = 'fitted around the chest while still loose at the hem, no stretching';
  }
  const subj = gender === 'female' ? 'woman' : 'man';

  // BODY block — different depending on whether we have a real body image
  const bodyBlock = hasModelImage
    ? [
        `═══ BODY (image #1) ═══`,
        `Preserve from image #1 EXACTLY:`,
        `• body shape, proportions, build, stance, gender`,
        `• face features, hair, skin tone, age (unless overridden by composing rule below)`
      ].join('\n')
    : [
        `═══ BODY (from description) ═══`,
        `Generate a photoreal ${subj} with these characteristics:`,
        `• gender: ${gender || 'male'}`,
        `• build: ${build || 'average'}`,
        `• height: ${height || 178} cm`,
        `• weight: ${weight || 75} kg`,
        `• ethnicity: Caucasian, age 22–30, neutral confident expression`,
        `• short natural hair (or feminine hair for women), no heavy makeup`,
        `• realistic body proportions matching height/weight (BMI-appropriate)`,
        `• stance: standing straight, weight slightly on one leg, hands relaxed`
      ].join('\n');

  const composing = hasUploadFace
    ? (hasModelImage
        ? `An additional PERSON REFERENCE is provided (image #2). Use it as a guide for FACE, hair, skin tone — but keep BODY shape strictly from image #1.`
        : `A PERSON REFERENCE PHOTO is provided (image #1). Use it as a guide for FACE, hair, skin tone — but adjust BODY shape to match the description above (height/weight/build).`)
    : '';

  const teeRefHint = (teeRefCount >= 2)
    ? `T-shirt references: TWO or more images at the end of the input. One shows the FRONT, another the BACK of the same t-shirt. Identify which is which from the visible graphic placement.`
    : `T-shirt reference: ONE image at the end. Use it as the source of truth for the side it shows; if it shows the back (most ULTERA tees are back-print), keep the front plain.`;

  return [
    `ULTERA TEES — Virtual Try-On (diptych output).`,
    ``,
    `═══ TASK ═══`,
    `Produce ONE single image that is a DIPTYCH (two equal halves side-by-side):`,
    `• LEFT HALF: the model standing facing the camera, FRONT view of the t-shirt visible.`,
    `• RIGHT HALF: the same model with their back to the camera, BACK view of the t-shirt visible.`,
    `Both halves: same studio, same lighting, same person, same t-shirt.`,
    ``,
    bodyBlock,
    ``,
    composing,
    ``,
    `═══ GARMENT REFERENCE ═══`,
    teeRefHint,
    `REPLICATE the t-shirt EXACTLY:`,
    `• print/graphic/text — same letters, glyphs, numbers (do NOT invent or rewrite — copy character by character)`,
    `• print placement, scale, colours, line weights, spacing`,
    `• t-shirt colour (${colorName || 'as shown'}) and fabric texture`,
    `• logo position, no extra text anywhere`,
    ``,
    `═══ T-SHIRT PHYSICAL SPECS ═══`,
    `• Oversized fit, drop-shoulder, 100% cotton 240 gsm`,
    `• Flat measurements (size L): chest width ${chest} cm (circumference ~${circ} cm), body length ${length} cm`,
    `• On this ${subj} (height ${height || '~178'} cm, weight ${weight || '~75'} kg, build ${build || 'average'}):`,
    `  – hem falls ${hem}`,
    `  – sleeves drop ~5 cm past natural shoulder seam`,
    `  – the t-shirt looks ${fit}`,
    ``,
    `═══ COMPOSITION ═══`,
    `• Format: 1536×1024 landscape, two figures side by side, equal width per half`,
    `• Both figures FULL BODY visible from head to mid-thigh, centered in their half`,
    `• Background: clean studio cyclorama, warm beige (#f1ede4 → #ebe6d9) gradient, soft natural daylight from front-left, gentle ground shadow under each figure`,
    `• PHOTOREALISTIC magazine-quality editorial fashion photography`,
    `• ABSOLUTELY NO added text, watermark, tag, label, "FRONT"/"BACK" annotations, logo other than the original t-shirt print`,
    ``,
    `Collection: ULTERA TEES${family ? ' ' + family : ''}${slug ? ' · ' + slug : ''}.`
  ].filter(Boolean).join('\n');
}

async function callGptImageEdit({ refImages, prompt, quality, model }) {
  const fd = new FormData();
  fd.append('model', model || 'gpt-image-1');
  fd.append('prompt', prompt);
  fd.append('n', '1');
  fd.append('size', '1536x1024');
  fd.append('quality', quality || 'medium');
  refImages.forEach((b, idx) => {
    const det = detectMime(b);
    fd.append('image', bytesToFile(b, 'ref-' + idx + '.' + det.ext, det.mime));
  });
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    body: fd
  });
  if (!r.ok) { const txt = await r.text(); throw new Error('OpenAI edits failed: ' + r.status + ' ' + txt.slice(0, 400)); }
  const j = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: no image returned');
  return Buffer.from(b64, 'base64');
}

// generations endpoint — для випадку коли немає референсного зображення взагалі
async function callGptImageGenerate({ prompt, quality, model }) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || 'gpt-image-1',
      prompt,
      n: 1,
      size: '1536x1024',
      quality: quality || 'medium'
    })
  });
  if (!r.ok) { const txt = await r.text(); throw new Error('OpenAI generate failed: ' + r.status + ' ' + txt.slice(0, 400)); }
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
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'Supabase env not configured' });
    }

    const ip = getClientIp(req);
    const limit = Number(process.env.TRYON_RATE_LIMIT_PER_MIN || 5);
    const rl = await checkRateLimit(ip, limit);
    if (!rl.allowed) return res.status(429).json({ error: 'too many requests' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { tshirt_id, model_id, photo_b64, gender: genderIn, height: heightIn, weight: weightIn } = body;
    const view = 'combined';

    if (!tshirt_id) return res.status(400).json({ error: 'tshirt_id required' });
    if (!model_id && !photo_b64) return res.status(400).json({ error: 'model_id or photo_b64 required' });

    // === 1. T-shirt ===
    const tshirt = await sbSelectOne(
      'ulhome_products',
      `id=eq.${encodeURIComponent(tshirt_id)}&select=id,uid,family,title,color_name,color_hex,photo`
    );
    if (!tshirt) return res.status(404).json({ error: 'tshirt not found' });
    if (!tshirt.photo) return res.status(422).json({ error: 'tshirt has no photo' });

    // === 2. Model source ===
    let modelMeta = null, modelBytes = null, uploadBytes = null, photoHash = null, cacheKey = null;
    let useModelImageAsRef = false;

    if (model_id) {
      modelMeta = await sbSelectOne(
        'ulhome_tryon_models',
        `id=eq.${encodeURIComponent(model_id)}&select=id,slug,gender,build,height_cm,weight_kg,image_url,published,is_icon`
      );
      if (!modelMeta || !modelMeta.published) return res.status(404).json({ error: 'model not found' });
      cacheKey = `model_id=eq.${modelMeta.id}&tshirt_id=eq.${tshirt.id}&view=eq.${view}`;
      useModelImageAsRef = !modelMeta.is_icon;
    }
    if (photo_b64) {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(photo_b64);
      if (!m) return res.status(400).json({ error: 'photo_b64 must be data:image/...;base64,...' });
      const ub = Buffer.from(m[2], 'base64');
      if (ub.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'photo too large (max 8MB)' });
      if (modelMeta) uploadBytes = ub;
      else { modelBytes = ub; photoHash = sha256Hex(ub); cacheKey = `photo_hash=eq.${photoHash}&tshirt_id=eq.${tshirt.id}&view=eq.${view}`; }
    }

    // === 3. Cache ===
    if (cacheKey && !uploadBytes) {
      const cached = await sbSelectOne('ulhome_tryon_cache', cacheKey + '&select=id,result_url,view');
      if (cached) {
        return res.status(200).json({
          ok: true, cached: true, view,
          result_url: cached.result_url,
          tshirt: { id: tshirt.id, uid: tshirt.uid, title: tshirt.title, color_name: tshirt.color_name }
        });
      }
    }

    // === 4. Збираємо референси ===
    const refImages = [];
    let hasModelImage = false;
    if (modelMeta && useModelImageAsRef) {
      modelBytes = await fetchAsBytes(modelMeta.image_url);
      refImages.push(modelBytes);
      hasModelImage = true;
    }
    if (uploadBytes) refImages.push(uploadBytes);
    if (!modelMeta && modelBytes) {  // upload-only mode: photo_b64 без model_id
      refImages.push(modelBytes);
      hasModelImage = true;
    }

    // === 5. T-shirt photos ===
    const media = await sbSelect(
      'ulhome_product_media',
      `product_id=eq.${encodeURIComponent(tshirt.id)}&select=url,sort_order&order=sort_order.asc&limit=4`
    );
    const teeUrls = [];
    if (Array.isArray(media) && media.length) media.forEach(m => { if (m && m.url && !/size_grid/i.test(m.url)) teeUrls.push(m.url); });
    if (!teeUrls.length && tshirt.photo) teeUrls.push(tshirt.photo);
    const seen = new Set();
    const teeUrlsClean = teeUrls.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; }).slice(0, 2);
    for (const u of teeUrlsClean) {
      try { refImages.push(await fetchAsBytes(absolutizePhoto(u))); }
      catch (e) { console.warn('skip tee photo', u, e.message); }
    }
    const teeRefCount = teeUrlsClean.length;
    if (teeRefCount < 1) return res.status(422).json({ error: 'no tee photos available' });

    // === 6. Prompt ===
    const prompt = buildPromptDiptych({
      gender: modelMeta?.gender || genderIn || 'male',
      build:  modelMeta?.build  || 'average',
      height: modelMeta?.height_cm || heightIn || null,
      weight: modelMeta?.weight_kg || weightIn || null,
      colorName: tshirt.color_name,
      family: tshirt.family,
      slug: tshirt.uid,
      hasUploadFace: !!uploadBytes,
      hasModelImage,
      teeRefCount
    });

    // === 7. OpenAI ===
    const quality = process.env.TRYON_QUALITY || 'medium';
    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    let resultBytes;
    if (refImages.length >= 1) {
      // Якщо є хоч одне фото (футболка обовʼязково), використовуємо edits endpoint
      resultBytes = await callGptImageEdit({ refImages, prompt, quality, model });
    } else {
      // (не повинно статись — футболка завжди є)
      resultBytes = await callGptImageGenerate({ prompt, quality, model });
    }

    // === 8. Save ===
    const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const tag = modelMeta ? modelMeta.slug : ('user-' + (photoHash || 'anon').slice(0, 12));
    const path = `${tshirt.uid}/combined-${tag}-${stamp}.png`;
    const resultUrl = await sbStorageUpload('tryon-results', path, resultBytes, 'image/png');

    // === 9. Cache ===
    if (cacheKey && !uploadBytes) {
      try {
        await sbInsert('ulhome_tryon_cache', {
          model_id: modelMeta?.id || null,
          photo_hash: photoHash,
          tshirt_uid: tshirt.uid,
          tshirt_id: tshirt.id,
          view,
          result_url: resultUrl,
          prompt: prompt.slice(0, 2000),
        