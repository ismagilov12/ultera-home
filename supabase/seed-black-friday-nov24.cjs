'use strict';

const photos = require('../lib/black-friday-nov24-photos.json');
const previous = require('../lib/black-friday-nov23.cjs');
const insole = {37:24, 38:25, 39:25.5, 40:26, 41:27, 42:28, 43:28.5, 44:29, 45:30};

const records = photos.map((item, index) => ({
  uid: item.existingUid || 'bf26-n24-' + item.id,
  title: 'Арт. ' + [item.article, item.line].filter(Boolean).join(' · '),
  article: item.article,
  color: item.color,
  photo: '/photos/black-friday/nov24/' + item.id + '.webp',
  previous_photo: item.existingUid ? previous.get(item.existingUid).photo : null,
  position: 50 + index,
  stock: item.stock,
  sizes: Object.keys(item.stock).map(eu => ({eu, cm:insole[eu]}))
}));

const sql = require('./black-friday-receipt.cjs')(records);
if (require.main === module) process.stdout.write(sql + '\n');
module.exports = {records, sql};
