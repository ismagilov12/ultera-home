'use strict';

const photos = require('./black-friday-new-photos.json');
const cmBySize = {37:24, 38:25, 39:25.5, 40:26, 41:27, 42:28, 43:28.5, 44:29, 45:30};
const directory = '/photos/black-friday/nov23/';

module.exports = new Map(photos.map((photo, index) => {
  const uid = 'bf26-n23-' + photo.id;
  const winter = /термо|зимові|черевики/i.test(photo.color);
  const season = winter ? 'Зима' : photo.article === 'СП10' ? 'Весна–літо' : null;
  return [uid, {
    uid, article: photo.article, title: 'Арт. ' + [photo.article, photo.line].filter(Boolean).join(' · '),
    color: photo.color, season, position: 100 + index, quantity: photo.quantity ?? 1,
    sizes: photo.sizes.map(eu => ({eu:String(eu), cm:cmBySize[eu]})),
    photo: directory + photo.id + '.webp', original: directory + 'pairs/' + photo.id + '.jpg'
  }];
}));
