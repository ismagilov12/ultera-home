// Public campaign catalogue. Prices come from the same product rows as checkout.
const {offers, offerVariants} = require('../lib/black-friday-offers.cjs');
function clearanceGallery(photo) {
  const match = /^\/photos\/black-friday\/([a-z]{3}\d{2})\/([a-z0-9-]+)\.webp$/.exec(photo || '');
  if (!match) return null;
  return {batch:match[1], pairPhoto:`/photos/black-friday/${match[1]}/pairs/${match[2]}.jpg`};
}
module.exports = async function blackFriday(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  try {
    if (!url || !key) throw new Error('Catalogue configuration missing');
    async function read(table, fields, filter) {
      const response = await fetch(url + '/rest/v1/' + table + '?select=' + fields + '&' + filter, {headers});
      if (!response.ok) throw new Error('Catalogue read failed');
      return response.json();
    }
    const related=[...offers.keys(), ...Array.from(offers.values(),o=>o.source)].join(',');
    const [products, stock] = await Promise.all([
      read('ulhome_products', 'uid,title,color_name,article,category,price,price_old,photo,mark,size_list,published', 'or=(and(uid.like.bf26-*,family.eq.SaleOstatki),uid.in.('+related+'))&order=sort_order.asc'),
      read('ulhome_sale_stock', 'uid,size,qty', 'uid=like.bf26-*&qty=gt.0')
    ]);
    const byUid = new Map(products.map(product=>[product.uid,product]));
    const quantities = new Map(stock.map(row => [row.uid + '/' + row.size, Number(row.qty)]));
    const items = [];
    for (const product of products) {
      const offer = offers.get(product.uid);
      const gallery = clearanceGallery(product.photo);
      if (!offer && !product.uid.startsWith('bf26-')) continue;
      const variants = [];
      const entries = offer ? offerVariants(offer,byUid.get(offer.source)) : product.size_list || [];
      for (const entry of entries) {
        const size = String(entry.eu);
        const qty = offer ? Number(entry.available) : quantities.get(product.uid + '/' + size);
        if (!Number.isFinite(qty) || (!offer && qty <= 0)) continue;
        const cm = Number(String(entry.cm ?? '').replace(',', '.'));
        variants.push({size, cm: cm > 0 && Number.isFinite(cm) ? cm : null, available: qty > 0,
          ...(gallery ? {quantity:qty} : {})});
      }
      const display = variants.find(variant => variant.available);
      if (!display) continue;
      const season = (product.category || '').split(';').map(tag => tag.trim())
        .find(tag => /весн|літо|осін|зим|сезон/i.test(tag));
      items.push({
        uid: product.uid, title: product.title, color: product.color_name,
        article: product.article, ...display, variants, unlimited: Boolean(offer),
        season: season || null, price: Number(product.price), photo: product.photo,
        oldPrice: Number(product.price_old) > Number(product.price) ? Number(product.price_old) : null,
        condition: product.mark || null,
        ...gallery
      });
    }
    return res.status(200).json({items});
  } catch (error) {
    console.error('[black-friday]', error.message);
    return res.status(503).json({error: 'Не вдалося завантажити пари.'});
  }
};
