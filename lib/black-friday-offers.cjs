'use strict';

// Each offer uses its original colour's availability without a separate clearance quota.
const fullSizeRun = ['40','41','42','43','44','45'];
const offers = new Map([
  ['bfoffer-aganta-thermo-oreo', {source:'550020261103', sizes:['40','41','42','43','44']}],
  ['bfoffer-hunk-thermo-black', {source:'550020260917', sizes:fullSizeRun}],
  ['bfoffer-aganta-aqva', {source:'260203663062', sizes:fullSizeRun}],
  ['bfoffer-aganta-salvia', {source:'977627506822', sizes:fullSizeRun}]
]);

function isCampaign(uid) {
  return (typeof uid === 'string' && uid.startsWith('bf26-')) || offers.has(uid);
}

function offerVariants(offer, product) {
  return (product?.size_list || []).filter(v=>offer.sizes.includes(String(v.eu))).map(v=>({
    ...v, available: product.published === true && Number(v.qty) > 0
  }));
}

async function validateOfferSizes(items) {
  const lines=items.filter(line=>offers.has(line?.uid));
  if (!lines.length) return;
  const ids=[...new Set(lines.map(line=>offers.get(line.uid).source))];
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/ulhome_products?select=uid,published,size_list&uid=in.('+ids.join(',')+')', {
    headers:{apikey:key,Authorization:'Bearer '+key}
  });
  if (!r.ok) throw new Error('Cannot check campaign sizes');
  const products=new Map((await r.json()).map(product=>[product.uid,product]));
  return lines.some(line=>{
    const offer=offers.get(line.uid);
    return !offerVariants(offer,products.get(offer.source)).some(v=>v.available && String(v.eu)===String(line.size));
  }) ? 'Обраного розміру немає серед акційних.' : null;
}

module.exports = {offers, isCampaign, offerVariants, validateOfferSizes};
