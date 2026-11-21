// Public campaign catalogue. Prices come from the same product rows as checkout.
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
    async function read(table, fields, filter = '') {
      const response = await fetch(url + '/rest/v1/' + table + '?uid=like.bf26-*&select=' + fields + filter, {headers});
      if (!response.ok) throw new Error('Catalogue read failed');
      return response.json();
    }
    const [products, stock] = await Promise.all([
      read('ulhome_products', 'uid,title,color_name,article,category,price,photo,mark,size_list', '&family=eq.SaleOstatki&order=sort_order.asc'),
      read('ulhome_sale_stock', 'uid,size,qty')
    ]);
    const quantities = new Map(stock.map(row => [row.uid + '/' + row.size, Number(row.qty)]));
    const items = products.map(product => {
      const variant = product.size_list[0];
      const size = String(variant.eu);
      const cm = Number(String(variant.cm ?? '').replace(',', '.'));
      const season = (product.category || '').split(';').map(tag => tag.trim())
        .find(tag => /весн|літо|осін|зим|сезон/i.test(tag));
      return {
        uid: product.uid, title: product.title, color: product.color_name,
        article: product.article, size, cm: cm > 0 && Number.isFinite(cm) ? cm : null,
        season: season || null, price: Number(product.price), photo: product.photo,
        condition: product.mark || null, available: (quantities.get(product.uid + '/' + size) || 0) > 0
      };
    });
    return res.status(200).json({items});
  } catch (error) {
    console.error('[black-friday]', error.message);
    return res.status(503).json({error: 'Не вдалося завантажити пари.'});
  }
};
