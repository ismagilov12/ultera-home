// api/sale-feed.js — ULTERA SALE -30% Facebook / Google Merchant Product Feed (XML RSS 2.0)
// Lives at /api/sale-feed and (via vercel.json rewrites) at /api/sale-feed.xml and /sale-feed.xml.
//
// SEPARATE feed for the /sale.html outlet page (-30% остатки). NOT the main catalog (/api/feed).
// Source of truth: hardcoded list mirrored 1:1 from sale.html (const D + const MEDIA).
// Regenerate this file whenever sale.html product list changes.
//
// Price model: <g:price> = full price, <g:sale_price> = saleP(p) = ceil(p*0.7/25)*25  (SALE_PCT=30).
// Links deep-link into the modal: https://ultera.in.ua/sale.html?p=<uid>
// Sizes = only the in-stock остаткові розміри from sale.html.

const SITE = "https://ultera.in.ua";
const SALE_PCT = 30;
const saleP = p => Math.ceil(p*(100-SALE_PCT)/100/25)*25;

const D = [{"uid":"671974984372","n":"Hunk2 Panda","c":"Panda","p":3590,"ph":"https://ultera-home.vercel.app/photos/55942430.webp","sz":["41"]},{"uid":"469658834434","n":"Hunk Mint","c":"Мʼятний","p":4100,"ph":"https://ultera-home.vercel.app/photos/aa0a01576c53f65f8087274daa9ebe54.webp","sz":["39"]},{"uid":"634978737742","n":"Hunk Pistachio","c":"Фісташковий","p":3990,"ph":"https://ultera-home.vercel.app/photos/28324109.webp","sz":["40","45"]},{"uid":"260203663062","n":"Aganta Aqva","c":"Аква","p":4100,"ph":"https://ultera-home.vercel.app/photos/23471110.webp","sz":["38","44","45"]},{"uid":"828457052803","n":"Aganta Safari","c":"Сафарі","p":4200,"ph":"https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776947101629-xc6bga.jpg","sz":["42","44"]},{"uid":"454860479882","n":"Aganta Black Nubuck","c":"Чорний нубук","p":3790,"ph":"https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776859553465-j97nc3.jpg","sz":["42","45"]},{"uid":"924701650982","n":"Aganta Oreo","c":"Базовий","p":3790,"ph":"https://ultera-home.vercel.app/photos/e82fd4d04441145469843abf55294e79.webp","sz":["37"]},{"uid":"270047232977","n":"Aganta Olive","c":"Олива","p":4200,"ph":"https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776946142411-n380e4.webp","sz":["40"]},{"uid":"977627506822","n":"Aganta Salvia","c":"Сальвія","p":4198,"ph":"https://ultera-home.vercel.app/photos/68403915.webp","sz":["41","45"]},{"uid":"938371874105","n":"Hunk3 Grey","c":"Grey","p":4500,"ph":"https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1778529257235-rww011.jpg","sz":["40","41"]},{"uid":"798291700932","n":"Hunk3 Asphalt","c":"Асфальт","p":4200,"ph":"https://ultera-home.vercel.app/photos/62232281.webp","sz":["41"]},{"uid":"375461019313","n":"Hunk3 RED","c":"Red","p":4500,"ph":"https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1778529207497-0edjfq.jpg","sz":["41","42"]},{"uid":"sale-u1-bel","n":"Hunk Білий","c":"Білий","p":3990,"ph":"https://ultera-home.vercel.app/photos/sale/u1-bel.png","sz":["44"],"nw":1},{"uid":"sale-u1-chern-zamsh","n":"Hunk Чорний замш","c":"Чорний замш","p":3990,"ph":"https://ultera-home.vercel.app/photos/sale/u1-chern-zamsh.png","sz":["41"],"nw":1},{"uid":"sale-u1-oliv","n":"Hunk Олива","c":"Олива","p":3990,"ph":"https://ultera-home.vercel.app/photos/sale/u1-oliv.png","sz":["41"],"nw":1},{"uid":"sale-u6-chern","n":"Trail Чорний","c":"Чорний","p":3990,"ph":"https://ultera-home.vercel.app/photos/sale/u6-chern.png","sz":["44"],"nw":1},{"uid":"sale-cros31","n":"CROS 31","c":"Чорний","p":3990,"ph":"https://ultera-home.vercel.app/photos/sale/cros31.png","sz":["44"],"nw":1},{"uid":"sale-u11-bel","n":"Hunk3 Білий","c":"Білий","p":3990,"ph":"https://ultera-home.vercel.app/photos/sale/u11-bel.png","sz":["41"],"nw":1}];
const PHOTOS = {"634978737742":["https://ultera-home.vercel.app/photos/28324109.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776715247768-6eq6m4.png","https://ultera-home.vercel.app/photos/e7e822bd106704acd7bf11bb951d0d8e.webp","https://ultera-home.vercel.app/photos/bae60a9364519a6e75af2f97c43a5f67.webp","https://ultera-home.vercel.app/photos/312a3a873a2e77e68ef08f097b07bdde.webp","https://ultera-home.vercel.app/photos/8bdcb9fa32abd0e20ae767e1b968064e.webp","https://ultera-home.vercel.app/photos/51a871c495cb44e30e69db81c735e965.webp","https://ultera-home.vercel.app/photos/9eed09d528d8e07e922e9610f6db531e.webp"],"469658834434":["https://ultera-home.vercel.app/photos/aa0a01576c53f65f8087274daa9ebe54.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776715310452-yvra3t.png","https://ultera-home.vercel.app/photos/125111864e64546570cf0d21d080d3a5.webp","https://ultera-home.vercel.app/photos/1531f3233ca00ef5b6f27d2c9176490c.webp","https://ultera-home.vercel.app/photos/10cb59803e6743ebfddd4d82545d07ed.webp","https://ultera-home.vercel.app/photos/829c659d1aa6bbd98509ba88a080ee8b.webp","https://ultera-home.vercel.app/photos/c4e39195601efd61ecef9d2926e7877f.webp","https://ultera-home.vercel.app/photos/fe863143f40b94297c82557d4a3de2d3.webp"],"828457052803":["https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776947117392-canboa.jpg","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/aganta-safari-1781872097-1.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/aganta-safari-1781872097-2.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/aganta-safari-1781872097-3.webp"],"938371874105":["https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1778529264703-ujl4za.jpg"],"270047232977":["https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776946908200-e4l371.webp"],"977627506822":["https://ultera-home.vercel.app/photos/68403915.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776702114819-jrqai2.png","https://ultera-home.vercel.app/photos/65535140.webp","https://ultera-home.vercel.app/photos/33796935.webp","https://ultera-home.vercel.app/photos/76806765.webp","https://ultera-home.vercel.app/photos/80718107.webp","https://ultera-home.vercel.app/photos/30793276.webp","https://ultera-home.vercel.app/photos/93492662.webp"],"260203663062":["https://ultera-home.vercel.app/photos/23471110.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776714982903-6hie3x.png","https://ultera-home.vercel.app/photos/91772469.webp","https://ultera-home.vercel.app/photos/53834366.webp","https://ultera-home.vercel.app/photos/60942294.webp","https://ultera-home.vercel.app/photos/49007791.webp","https://ultera-home.vercel.app/photos/71454489.webp","https://ultera-home.vercel.app/photos/22517937.webp"],"454860479882":["https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776859568133-kskkyu.jpg","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776715217526-p4xhgr.png","https://ultera-home.vercel.app/photos/79435477.webp","https://ultera-home.vercel.app/photos/74960268.webp","https://ultera-home.vercel.app/photos/91225369.webp","https://ultera-home.vercel.app/photos/46194880.webp","https://ultera-home.vercel.app/photos/66793627.webp","https://ultera-home.vercel.app/photos/54734429.webp"],"671974984372":["https://ultera-home.vercel.app/photos/55942430.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776715144331-lbg300.png","https://ultera-home.vercel.app/photos/b2cbefa5d40d1aed2bef7da17b79f79a.webp","https://ultera-home.vercel.app/photos/de0c6e87a8c072eae65c0c8627e08ff2.webp","https://ultera-home.vercel.app/photos/21564de058d1435cf3f13583afc590fd.webp","https://ultera-home.vercel.app/photos/c6eb5201940239bed6b785999bde10a0.webp","https://ultera-home.vercel.app/photos/99548488.webp","https://ultera-home.vercel.app/photos/58038427.webp"],"375461019313":["https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1778529214250-o3bcds.jpg","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/hunk3-red-1781873080-1.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/hunk3-red-1781873080-2.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/hunk3-red-1781873080-3.webp"],"924701650982":["https://ultera-home.vercel.app/photos/e82fd4d04441145469843abf55294e79.webp","https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/ulhome-media/p/1776702099684-9aaqbd.png","https://ultera-home.vercel.app/photos/36484555.webp","https://ultera-home.vercel.app/photos/32239824.webp","https://ultera-home.vercel.app/photos/86499737.webp","https://ultera-home.vercel.app/photos/54255902.webp","https://ultera-home.vercel.app/photos/51977286.webp","https://ultera-home.vercel.app/photos/67365293.webp"]};

function xescape(s){
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function modelSlug(n){
  // first token -> group variants (Hunk, Hunk2, Hunk3, Aganta, Trail, CROS)
  const t = String(n||"").trim().split(/\s+/)[0] || "misc";
  return t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") || "misc";
}

module.exports = async function handler(req, res){
  try {
    const items = [];
    for (const x of D){
      const full = Math.round(parseFloat(x.p)||0);
      const sale = saleP(full);
      const link = SITE + "/sale.html?p=" + encodeURIComponent(String(x.uid));
      const extras = (PHOTOS[x.uid]||[]).filter(u => u && u !== x.ph).slice(0,10);
      const sizes = (Array.isArray(x.sz)? x.sz : []).join(",");
      const descParts = [
        x.n + " — розпродаж остатків -" + SALE_PCT + "%.",
        "Колір: " + x.c + ".",
        x.nw ? "Нова модель, остання пара." : "",
        "Розміри в наявності: " + (sizes||"уточнюйте") + ".",
        "Українське взуття ручної роботи, натуральна шкіра. Доставка Новою Поштою."
      ].filter(Boolean);

      const f = [];
      f.push("<g:id>sl_" + xescape(x.uid) + "</g:id>");
      f.push("<g:title>" + xescape("ULTERA " + x.n + " · -" + SALE_PCT + "%") + "</g:title>");
      f.push("<g:description>" + xescape(descParts.join(" ")) + "</g:description>");
      f.push("<g:link>" + xescape(link) + "</g:link>");
      f.push("<g:image_link>" + xescape(x.ph) + "</g:image_link>");
      for (const u of extras) f.push("<g:additional_image_link>" + xescape(u) + "</g:additional_image_link>");
      f.push("<g:availability>in stock</g:availability>");
      f.push("<g:condition>new</g:condition>");
      f.push("<g:price>" + full + ".00 UAH</g:price>");
      f.push("<g:sale_price>" + sale + ".00 UAH</g:sale_price>");
      f.push("<g:brand>ULTERA</g:brand>");
      f.push("<g:google_product_category>187</g:google_product_category>");
      f.push("<g:product_type>" + xescape("Apparel > Footwear > Sneakers") + "</g:product_type>");
      f.push("<g:identifier_exists>no</g:identifier_exists>");
      f.push("<g:item_group_id>" + xescape("sale-" + modelSlug(x.n)) + "</g:item_group_id>");
      f.push("<g:color>" + xescape(x.c) + "</g:color>");
      if (sizes){ f.push("<g:size>" + xescape(sizes) + "</g:size>"); f.push("<g:size_system>EU</g:size_system>"); }
      f.push("<g:gender>male</g:gender>");
      f.push("<g:age_group>adult</g:age_group>");
      f.push("<g:custom_label_0>SALE-" + SALE_PCT + "</g:custom_label_0>");
      f.push("<g:custom_label_1>" + (x.nw ? "ostatok" : "sale") + "</g:custom_label_1>");
      f.push("<g:shipping><g:country>UA</g:country><g:service>Нова Пошта</g:service><g:price>0 UAH</g:price></g:shipping>");

      items.push("    <item>\n      " + f.join("\n      ") + "\n    </item>");
    }

    const xml =
"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
"<rss xmlns:g=\"http://base.google.com/ns/1.0\" version=\"2.0\">\n" +
"  <channel>\n" +
"    <title>ULTERA — SALE -" + SALE_PCT + "% Feed</title>\n" +
"    <link>" + SITE + "/sale.html</link>\n" +
"    <description>ULTERA · розпродаж остатків -" + SALE_PCT + "%. Українське взуття ручної роботи.</description>\n" +
"    <lastBuildDate>" + new Date().toUTCString() + "</lastBuildDate>\n" +
items.join("\n") + "\n" +
"  </channel>\n" +
"</rss>\n";

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600, stale-while-revalidate=3600");
    res.setHeader("X-Feed-Items", String(items.length));
    res.end(xml);
  } catch (e){
    try { console.error("[sale-feed] error", e && e.message); } catch(_){}
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Sale feed error: " + (e && e.message ? e.message : "unknown"));
  }
};
