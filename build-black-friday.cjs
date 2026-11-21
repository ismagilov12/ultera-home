const fs = require('node:fs');
const path = require('node:path');

function splitAt(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Missing storefront marker ' + marker);
  return [html.slice(0, start), html.slice(start + marker.length)];
}

// The storefront also binds controls in the home banner, navigation and footer.
// Keep their DOM hooks inert on the campaign without downloading their media.
function homeOnly(markup) {
  const inert = markup.replace(/<(?:img|source|video|iframe)\b[^>]*>/gi, tag =>
    tag.replace(/\s(?:src|srcset|poster|data-src|data-srcset|autoplay)(?:="[^"]*"|='[^']*')?(?=[\s/>])/gi, '')
  );
  return '<div hidden inert>' + inert + '</div>';
}

function compose(storefront, campaign) {
  const [storeHead, storeBody] = splitAt(storefront, '<body>');
  const [before, fromCollection] = splitAt(storeBody, '<!-- NEW COLLECTION -->');
  const [collection, afterCollection] = splitAt(fromCollection, '<!-- SALE OSTATKI');
  const [otherSections, commerce] = splitAt(afterCollection, '<!-- CART DRAWER -->');
  const [campaignHead, fromCampaignBody] = splitAt(campaign, '<body>');
  const [campaignBody] = splitAt(fromCampaignBody, '</body>');
  const [, meta] = splitAt(campaignHead, '<head>');
  const [campaignMeta] = splitAt(meta, '</head>');
  const head = storeHead
    .replace(/^\s*<title>[^<]*<\/title>/im, '')
    .replace(/^\s*<meta (?:charset=|name="(?:description|viewport|theme-color)"|property="og:)[^>]*>/gim, '')
    .replace(/^\s*<link (?:rel="canonical"|rel="preload" as="image"[^>]*href="banners\/home-)[^>]*>/gim, '')
    .replace('<head>', () => '<head>' + campaignMeta);
  return head + '<body>' + homeOnly(before) +
    '<div id="bf-storefront"><template shadowrootmode="open">' + campaignBody + '</template>' +
    '<span id="pairs" slot="pairs-anchor"></span><div id="catalog" slot="catalog">' + collection + '</div></div>' +
    homeOnly('<!-- SALE OSTATKI' + otherSections) + '<!-- CART DRAWER -->' + commerce;
}

if (require.main === module) {
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'black-friday.html'), compose(read('index.html'), read('templates/black-friday.html')));
}
module.exports = compose;
