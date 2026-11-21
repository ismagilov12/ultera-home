const fs = require('node:fs');
const path = require('node:path');
const compose = require('../lib/black-friday-page.cjs');

let page;
module.exports = function blackFridayPage(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  if (!page) {
    const read = filename => fs.readFileSync(path.join(process.cwd(), filename), 'utf8');
    page = compose(read('index.html'), read('templates/black-friday.html'));
  }
  // Only the shared HTML is cached. Stock and prices load from the live shop.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=86400');
  return res.status(200).end(req.method === 'HEAD' ? undefined : page);
};
