'use strict';

const photos = require('../lib/black-friday-nov25-photos.json');
const receivedStockSql = require('./black-friday-receipt.cjs');

const insole = {37:24, 38:25, 39:25.5, 40:26, 41:27, 42:28, 43:28.5, 44:29, 45:30, 46:30.5};
const records = photos.map((item, index) => ({
  uid: item.existingUid || 'bf26-n25-' + item.id,
  title: 'Арт. ' + item.article,
  article: item.article,
  color: item.color,
  season: item.season || null,
  photo: '/photos/black-friday/nov25/' + item.id + '.webp',
  previous_photo: item.previousPhoto || null,
  position: 18 + index,
  stock: item.stock,
  sizes: Object.keys(item.stock).map(eu => ({eu, cm:insole[eu]}))
}));

const sql = receivedStockSql(records);
if (require.main === module) process.stdout.write(sql + '\n');
module.exports = {records, sql};
