'use strict';

// Offer-only accessory: keep it out of the shoe grid and advertising feed.
// This endpoint exposes only this product's public storefront fields, never
// arbitrary catalogue rows, credentials, costs, or customer information.
const INSOLE_UID = '900000000249';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false });
  }
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return res.status(503).json({ ok: false });
  try {
    const url = new URL('/rest/v1/ulhome_products', base);
    url.searchParams.set('uid', 'eq.' + INSOLE_UID);
    url.searchParams.set('family', 'eq.Insole');
    url.searchParams.set('select', 'uid,title,family,price,photo');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('catalogue_unavailable');
    const rows = await response.json();
    const product = Array.isArray(rows) && rows[0];
    const price = product && Number(product.price);
    if (!product || product.uid !== INSOLE_UID || product.family !== 'Insole' || !Number.isFinite(price) || price <= 0) {
      return res.status(200).json({ ok: true, product: null });
    }
    let photo = '';
    try {
      const image = new URL(product.photo);
      if (image.protocol === 'https:') photo = image.href;
    } catch (_) {}
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(200).json({ ok: true, product: {
      uid: INSOLE_UID, title: 'Змінні устілки ULTERA', family: 'Insole', price, photo
    }});
  } catch (_) {
    console.warn('[insole-offer] Catalogue read failed');
    return res.status(503).json({ ok: false });
  }
};
