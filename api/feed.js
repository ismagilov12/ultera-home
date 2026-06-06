// api/feed.js — ULTERA Facebook / Google Merchant Product Feed (XML RSS 2.0)
// Lives at /api/feed and (via vercel.json rewrites) at /api/feed.xml and /feed.xml.
// Source of truth: Supabase ulhome_products (published=true) + ulhome_product_media.
//
// Output spec:
//   Content-Type: application/xml; charset=utf-8
//   Cache-Control: public, max-age=600, s-maxage=600, stale-while-revalidate=3600
//
// Variants: each color = separate <item> with shared <g:item_group_id> = family.
// Deep-link format: ?p=<slug>,<uid> — same router as deploy-deeplinks-v1.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const SITE = 'https://ultera.in.ua';

// === slug helpers (mirror _build_deploy_deeplinks_v1.py 1:1) ===
const COLOR_DICT = {
  'чорний':'black','чёрный':'black','черный':'black',
  'білий':'white','белый':'white','white':'white',
  'сірий':'grey','серый':'grey',
  'сіро-білий':'grey-white','серо-белый':'grey-white',
  'чорний/білий':'black-white','чорний-білий':'black-white',
  'бронзово-білий':'bronze-white',
  'чорний нубук':'black-nubuck',
  'чорний brft':'black-brft','brft':'brft',
  'чорний замша':'black-suede',
  'all black':'all-black',
  'сальвія':'salvia',
  'аква':'aqua',
  'фісташковий':'pistachio',
  'мʼятний':'mint',"м'ятний":'mint','мятный':'mint',
  'олива':'olive','оливковий':'olive',
  'вино':'wine','винний':'wine',
  'асфальт':'asphalt',
  'коричневий':'brown',
  'бежевий':'beige',
  'блакитний':'blue',
  'бордо':'bordeaux','бордовий':'bordeaux',
  'помаранчевий':'orange',
  'червоний':'red',
  'крем':'cream','кремовий':'cream',
  'panda':'panda',
  'сафарі':'safari',
  'базовий':'basic'
};

const TR_MAP = {
  'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ie',
  'ж':'zh','з':'z','и':'y','і':'i','ї':'i','й':'i','к':'k','л':'l',
  'м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'',
  'ю':'iu','я':'ia','ы':'y','э':'e','ъ':'','ё':'e',"'":'','ʼ':''
};

function tr(s){
  s = String(s||'').toLowerCase();
  let out = '';
  for (let i=0;i<s.length;i++){
    const ch = s[i];
    out += (TR_MAP[ch] !== undefined) ? TR_MAP[ch] : ch;
  }
  return out;
}

function slugify(s){
  s = String(s||'').trim();
  const low = s.toLowerCase().trim();
  if (COLOR_DICT[low]) return COLOR_DICT[low];
  s = tr(s);
  s = s.replace(/[^a-z0-9]+/g,'-');
  s = s.replace(/-+/g,'-').replace(/^-+|-+$/g,'');
  return s;
}

function buildFootwearSlug(family, colorName, uid){
  const fam = slugify(family || '');
  let col = slugify(colorName || '');
  if (!col || col === fam) col = String(uid||'').slice(-6);
  if (!fam) return col || slugify(uid);
  return fam + '-' + col;
}

function buildTeeSlug(p){
  // Title pattern: "ULTERA Tees™ — HUNK3 · 01" or "ULTERA Tees™ — ULTERA · 02 · Рожевий"
  const t = String(p.title||'');
  const m = t.match(/[—\-]\s*([A-Za-z0-9]+)\s*[·.]\s*(\d+)(?:\s*[·.]\s*(.+))?/);
  if (m){
    let s = slugify(m[1]) + '-' + String(m[2]).padStart(2,'0');
    if (m[3]) s += '-' + slugify(m[3].trim());
    return s;
  }
  return slugify(p.uid);
}

function buildLink(p){
  let slug;
  if (p.family === 'Tees'){
    slug = buildTeeSlug(p);
  } else {
    slug = buildFootwearSlug(p.family, p.color_name, p.uid);
  }
  const token = slug + ',' + String(p.uid||'');
  const page = (p.family === 'Tees') ? '/tshirts.html' : '/';
  return SITE + page + '?p=' + encodeURIComponent(token);
}

// === XML helpers ===
function xescape(s){
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&apos;');
}

function mapGender(g){
  if (g === 'm') return 'male';
  if (g === 'f') return 'female';
  return 'unisex';
}

function fmtPrice(n){
  const v = Math.round(parseFloat(n) || 0);
  return v + '.00 UAH';
}

function buildTitle(p){
  const t = String(p.title||'').trim();
  if (t) return t;
  return [p.family, p.color_name].filter(Boolean).join(' · ');
}

function stripHtml(s){
  return String(s||'')
    .replace(/<li[^>]*>/gi, ' • ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|ul|ol|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDescription(p){
  const parts = [];
  const ds = stripHtml(p.desc_short);
  const dd = stripHtml(p.description);
  if (ds) parts.push(ds);
  if (dd && dd !== ds) parts.push(dd);
  if (p.color_name) parts.push('Колір: ' + p.color_name + '.');
  if (p.family !== 'Tees') parts.push('Українське взуття ручної роботи. Доставка Новою Поштою.');
  else parts.push('Оверсайз футболка 100% бавовна 240 gsm. Зроблено в Україні.');
  return parts.join(' ').slice(0, 4900); // FB description limit 5000
}

function productType(p){
  if (p.family === 'Tees') return 'Apparel > T-Shirts > Oversized';
  return 'Apparel > Footwear > Sneakers > ' + (p.family || 'Misc');
}

function googleCategory(p){
  // 212 = Apparel & Accessories > Clothing > Shirts & Tops
  // 187 = Apparel & Accessories > Shoes
  return p.family === 'Tees' ? '212' : '187';
}

function itemGroupId(p){
  return p.family ? slugify(p.family) : 'misc';
}

// === Supabase fetch ===
async function sbFetch(path, headers){
  const r = await fetch(path, { headers });
  if (!r.ok){
    const t = await r.text().catch(()=>'');
    throw new Error('Supabase ' + r.status + ' on ' + path + ': ' + t.slice(0,200));
  }
  return r.json();
}

async function fetchAllMedia(baseUrl, headers){
  // PostgREST default limit 1000; we have ~767 photo rows but use Range to be safe.
  const out = [];
  let from = 0;
  const step = 1000;
  while (true){
    const hh = Object.assign({}, headers, {
      'Range-Unit': 'items',
      'Range': from + '-' + (from + step - 1),
      'Prefer': 'count=exact'
    });
    const r = await fetch(
      baseUrl + '/rest/v1/ulhome_product_media?select=product_id,url,type,sort_order&type=eq.photo&order=product_id.asc,sort_order.asc',
      { headers: hh }
    );
    if (!r.ok) break;
    const arr = await r.json();
    out.push(...arr);
    if (arr.length < step) break;
    from += step;
    if (from > 5000) break; // safety cap
  }
  return out;
}

module.exports = async function handler(req, res){
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey){
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Supabase env vars missing');
      return;
    }
    const headers = {
      apikey: sbKey,
      Authorization: 'Bearer ' + sbKey,
      'Accept': 'application/json'
    };

    const products = await sbFetch(
      sbUrl + '/rest/v1/ulhome_products?select=id,uid,family,title,color_name,color_hex,price,price_old,mark,description,desc_short,photo,gender,category,sort_order,published&published=eq.true&order=family.asc,sort_order.asc',
      headers
    );

    const media = await fetchAllMedia(sbUrl, headers);
    const mediaByProduct = {};
    for (const m of media){
      if (!m.url) continue;
      (mediaByProduct[m.product_id] = mediaByProduct[m.product_id] || []).push(m.url);
    }

    const items = [];
    let skipped = 0;
    for (const p of products){
      const mainImg = p.photo;
      if (!mainImg){ skipped++; continue; }

      const extras = (mediaByProduct[p.id] || [])
        .filter(u => u && u !== mainImg)
        .slice(0, 10);

      const isTees = p.family === 'Tees';
      const brand = isTees ? 'ULTERA TEES' : 'ULTERA';
      const link = buildLink(p);
      const priceNew = Math.round(parseFloat(p.price) || 0);
      const priceOld = p.price_old ? Math.round(parseFloat(p.price_old)) : null;

      const fields = [];
      fields.push('<g:id>' + xescape(p.uid) + '</g:id>');
      fields.push('<g:title>' + xescape(buildTitle(p)) + '</g:title>');
      fields.push('<g:description>' + xescape(buildDescription(p)) + '</g:description>');
      fields.push('<g:link>' + xescape(link) + '</g:link>');
      fields.push('<g:image_link>' + xescape(mainImg) + '</g:image_link>');
      for (const u of extras){
        fields.push('<g:additional_image_link>' + xescape(u) + '</g:additional_image_link>');
      }
      fields.push('<g:availability>in stock</g:availability>');
      fields.push('<g:condition>new</g:condition>');
      if (priceOld && priceOld > priceNew){
        fields.push('<g:price>' + priceOld + '.00 UAH</g:price>');
        fields.push('<g:sale_price>' + priceNew + '.00 UAH</g:sale_price>');
      } else {
        fields.push('<g:price>' + priceNew + '.00 UAH</g:price>');
      }
      fields.push('<g:brand>' + xescape(brand) + '</g:brand>');
      fields.push('<g:google_product_category>' + googleCategory(p) + '</g:google_product_category>');
      fields.push('<g:product_type>' + xescape(productType(p)) + '</g:product_type>');
      fields.push('<g:identifier_exists>no</g:identifier_exists>');
      fields.push('<g:item_group_id>' + xescape(itemGroupId(p)) + '</g:item_group_id>');
      if (p.color_name) fields.push('<g:color>' + xescape(p.color_name) + '</g:color>');
      if (isTees){
        fields.push('<g:size>L</g:size>');
        fields.push('<g:size_system>EU</g:size_system>');
        fields.push('<g:material>100% бавовна 240 gsm</g:material>');
      } else {
        fields.push('<g:size>40,41,42,43,44,45</g:size>');
        fields.push('<g:size_system>EU</g:size_system>');
      }
      fields.push('<g:gender>' + mapGender(p.gender) + '</g:gender>');
      fields.push('<g:age_group>adult</g:age_group>');
      if (p.mark) fields.push('<g:custom_label_0>' + xescape(p.mark) + '</g:custom_label_0>');
      fields.push('<g:custom_label_1>' + xescape(p.family || '') + '</g:custom_label_1>');
      fields.push('<g:shipping><g:country>UA</g:country><g:service>Нова Пошта</g:service><g:price>0 UAH</g:price></g:shipping>');

      items.push('    <item>\n      ' + fields.join('\n      ') + '\n    </item>');
    }

    const xml =
'<?xml version="1.0" encoding="UTF-8"?>\n' +
'<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n' +
'  <channel>\n' +
'    <title>ULTERA — Product Feed</title>\n' +
'    <link>' + SITE + '/</link>\n' +
'    <description>ULTERA · взуття та одяг ручної роботи. Зроблено в Україні.</description>\n' +
'    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
items.join('\n') + '\n' +
'  </channel>\n' +
'</rss>\n';

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600');
    res.setHeader('X-Feed-Items', String(items.length));
    res.setHeader('X-Feed-Skipped', String(skipped));
    res.end(xml);
  } catch (e){
    try { console.error('[feed] error', e && e.message); } catch(_){}
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Feed error: ' + (e && e.message ? e.message : 'unknown'));
  }
};
