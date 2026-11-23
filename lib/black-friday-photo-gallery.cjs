const photos = require('./black-friday-new-photos.json');

// Insole lengths from the ULTERA size guide used by the sale catalogue.
const insoles = {36:'23,5', 37:'24', 38:'25', 39:'25,5', 40:'26', 41:'27', 42:'28', 43:'28,5', 44:'29', 45:'30', 46:'30,5'};
const directory = '/photos/black-friday/nov23/';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

function photoCard(photo) {
  const article = 'Арт. ' + escape(photo.article) + (photo.line ? ' · ' + escape(photo.line) : '');
  const color = escape(photo.color);
  const name = article + ' · ' + color;
  const file = encodeURIComponent(photo.id);
  const sizes = photo.sizes.map(size => '<li>EU ' + size + ' · ' + insoles[size] + ' см</li>').join('');
  return '<article class="new-photo-card" data-photo-sizes="' + photo.sizes.join(' ') + '"><a class="new-photo-link" data-pair-photo href="' + directory + 'pairs/' + file +
    '.jpg" aria-label="Фото пари · ' + name + ' · EU ' + photo.sizes.join(', ') + '"><img loading="lazy" decoding="async" src="' +
    directory + file + '.webp" width="640" height="480" alt="' + name + '"></a><div class="new-photo-info"><h3>' + article +
    '</h3><p>' + color + '</p><ul aria-label="Розміри та довжина устілки за сіткою ULTERA">' + sizes + '</ul></div></article>';
}

module.exports = function renderPhotoGallery() {
  const first = 8;
  const grid = list => '<div class="new-photo-grid">' + list.map(photoCard).join('') + '</div>';
  const sizes = [...new Set(photos.flatMap(photo => photo.sizes))].sort((a,b) => a-b);
  const options = sizes.map(size => '<option value="' + size + '">EU ' + size + ' · ' + insoles[size] + ' см</option>').join('');
  return '<label class="photo-filter" hidden>Розмір <select id="new-photo-size"><option value="">Усі розміри</option>' + options +
    '</select></label>' + grid(photos.slice(0, first)) + '<details class="more-photos"><summary><span>Переглянути всі ' + photos.length +
    ' фото</span><span>Згорнути добірку</span></summary>' + grid(photos.slice(first)) + '</details>';
};
