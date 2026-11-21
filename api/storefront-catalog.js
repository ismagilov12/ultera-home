const rules = require('../assets/storefront-catalog-rules');

const hunkColors = new Set(Object.values(rules.hunk));
const winterColors = new Set(Object.values(rules.agantaThermo));

function collectFamilies(products, ordering) {
  const visibility = new Map(ordering.map(row => [row.family, row]));
  const families = new Map();

  for (const product of products) {
    const {uid, family} = product;
    if (!family || family === 'Tees' || family === 'SaleOstatki' || uid.startsWith('bf26-')) continue;
    if (family === 'Hunk' && !hunkColors.has(uid)) continue;
    // The main shop merges its current Aganta winter colorways into the Thermo row.
    if (family === 'Aganta Thermo' && !winterColors.has(uid)) continue;
    const key = family === 'Aganta Thermo' ? 'Thermo' : family;
    if (visibility.get(family)?.hidden || visibility.get(key)?.hidden) continue;
    const price = rules.fixedPrices[uid] ?? Number(product.price);
    if (!Number.isFinite(price) || price <= 0 || !product.photo) continue;

    if (!families.has(key)) {
      families.set(key, {family:key, name:rules.familyNames[key] || key, variants:[]});
    }
    const variant = {
      uid, color:product.color_name || product.title, swatch:product.color_hex || '',
      photo:uid === rules.nubuck.uid ? rules.nubuck.photo : product.photo, gender:product.gender,
      price, available:!rules.soldOut.includes(uid)
    };
    const variants = families.get(key).variants;
    // SHAPE opens with its black colorway in the storefront.
    if (key === 'SHAPE' && uid === '340180708714') variants.unshift(variant);
    else variants.push(variant);
  }
  const rank = family => visibility.get(family)?.sort_order ?? 9999;
  return [...families.values()].sort((a,b) => rank(a.family)-rank(b.family) || a.name.localeCompare(b.name,'uk'));
}

async function readRows(base, headers, query) {
  const rows = [];
  const limit = 100;
  while (true) {
    const response = await fetch(base + '/rest/v1/' + query, {
      headers:{...headers, 'Range-Unit':'items', Range:rows.length + '-' + (rows.length + limit - 1)}
    });
    if (!response.ok) throw new Error('Catalogue read failed');
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Invalid catalogue response');
    rows.push(...page);
    if (page.length < limit) return rows;
  }
}

module.exports = async function storefrontCatalog(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).end();
  }
  try {
    const base = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) throw new Error('Missing catalogue configuration');
    const headers = {apikey:key, Authorization:'Bearer ' + key};
    const [products, ordering] = await Promise.all([
      readRows(base, headers, 'ulhome_products?select=uid,family,title,color_name,color_hex,price,photo,gender&published=eq.true&family=not.in.(SaleOstatki,Tees)&order=sort_order.asc.nullslast,uid.asc'),
      readRows(base, headers, 'ulhome_family_order?select=family,sort_order,hidden&order=sort_order.asc,family.asc')
    ]);
    return res.status(200).json({families:collectFamilies(products,ordering)});
  } catch (error) {
    console.error('[storefront-catalog]',error.message);
    return res.status(503).json({error:'Не вдалося завантажити основний каталог.'});
  }
};
