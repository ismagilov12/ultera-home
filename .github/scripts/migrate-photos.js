/*
 * migrate-photos.js — one-shot migration of Tilda-hosted product photos to Vercel repo.
 *
 * Steps:
 *   1. Parse DATA + EXTRA JSON blocks from index.html
 *   2. Collect unique https://static.tildacdn.com/ URLs
 *   3. Download each, resize max 900px wide, convert to WebP (quality 82)
 *   4. Save to photos/<basename>.webp
 *   5. Rewrite DATA + EXTRA so every Tilda URL becomes /photos/<basename>.webp
 *   6. Write the patched index.html back
 *
 * Idempotent: re-running skips already-converted files.
 * Parallelism: 8 concurrent downloads to stay polite to Tilda.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CONCURRENCY = 8;
const MAX_WIDTH = 900;
const WEBP_QUALITY = 82;
const PHOTOS_DIR = 'photos';

function extractJsonBlock(html, id) {
  const re = new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>');
  const m = html.match(re);
  if (!m) throw new Error('Missing <script id="' + id + '"> block');
  return { start: m.index, raw: m[0], inner: m[1] };
}

function replaceJsonBlock(html, id, newInner) {
  const re = new RegExp('(<script id="' + id + '"[^>]*>)[\\s\\S]*?(</script>)');
  return html.replace(re, function(_, open, close) {
    return open + newInner + close;
  });
}

function isTildaUrl(u) {
  return typeof u === 'string' && u.indexOf('https://static.tildacdn.com/') === 0;
}

function basenameOf(url) {
  const tail = url.split('?')[0].split('#')[0];
  const parts = tail.split('/');
  const last = parts[parts.length - 1];
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

function collectUrls(data, extra) {
  const urls = new Set();
  function walk(obj) {
    if (isTildaUrl(obj)) { urls.add(obj); return; }
    if (Array.isArray(obj)) { for (const x of obj) walk(x); return; }
    if (obj && typeof obj === 'object') { for (const k of Object.keys(obj)) walk(obj[k]); }
  }
  walk(data);
  walk(extra);
  return Array.from(urls);
}

async function runPool(items, handler, size) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await handler(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function downloadAndConvert(url) {
  const base = basenameOf(url);
  if (!base) throw new Error('Empty basename for ' + url);
  const out = path.join(PHOTOS_DIR, base + '.webp');
  const publicPath = '/' + out.split(path.sep).join('/');

  if (fs.existsSync(out) && fs.statSync(out).size > 100) {
    return { url: url, out: publicPath, skipped: true };
  }

  const res = await fetch(url);
  if (res.ok === false) {
    throw new Error('HTTP ' + res.status + ' for ' + url);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  await sharp(buf)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(out);

  return { url: url, out: publicPath, skipped: false };
}

function rewriteUrls(obj, mapping) {
  if (typeof obj === 'string') return mapping.get(obj) || obj;
  if (Array.isArray(obj)) return obj.map(x => rewriteUrls(x, mapping));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = rewriteUrls(obj[k], mapping);
    return out;
  }
  return obj;
}

async function main() {
  console.log('[migrate] reading index.html');
  const html = fs.readFileSync('index.html', 'utf-8');

  const dataBlock = extractJsonBlock(html, 'DATA');
  const extraBlock = extractJsonBlock(html, 'EXTRA');
  const data = JSON.parse(dataBlock.inner);
  const extra = JSON.parse(extraBlock.inner);

  const urls = collectUrls(data, extra);
  console.log('[migrate] ' + urls.length + ' unique Tilda URLs');

  if (urls.length === 0) {
    console.log('[migrate] nothing to migrate, exiting');
    return;
  }

  fs.mkdirSync(PHOTOS_DIR, { recursive: true });

  const mapping = new Map();
  let ok = 0, skipped = 0, failed = 0;

  await runPool(urls, async (url) => {
    try {
      const r = await downloadAndConvert(url);
      mapping.set(url, r.out);
      if (r.skipped) skipped++;
      else ok++;
      if ((ok + skipped) % 20 === 0) {
        console.log('[migrate] ' + (ok + skipped) + '/' + urls.length +
          ' (ok=' + ok + ' skipped=' + skipped + ' failed=' + failed + ')');
      }
    } catch (e) {
      failed++;
      console.error('[migrate] FAIL ' + url + ' : ' + e.message);
    }
  }, CONCURRENCY);

  console.log('[migrate] done: ok=' + ok + ' skipped=' + skipped + ' failed=' + failed);

  if (mapping.size === 0) {
    console.log('[migrate] nothing converted, not rewriting html');
    return;
  }

  console.log('[migrate] rewriting DATA + EXTRA JSON with new paths');
  const newData = rewriteUrls(data, mapping);
  const newExtra = rewriteUrls(extra, mapping);

  let newHtml = replaceJsonBlock(html, 'DATA', JSON.stringify(newData));
  newHtml = replaceJsonBlock(newHtml, 'EXTRA', JSON.stringify(newExtra));

  if (newHtml.endsWith('</html>') === false && newHtml.endsWith('</html>\n') === false) {
    throw new Error('Patched index.html does not end with </html>');
  }

  fs.writeFileSync('index.html', newHtml, 'utf-8');
  console.log('[migrate] index.html updated, ' + mapping.size + ' URLs rewritten');
}

main().then(() => process.exit(0), (e) => {
  console.error('[migrate] fatal', e);
  process.exit(1);
});
