(function () {
  'use strict';
  var UID = '900000000249';
  var FOOTWEAR = ['01','02','Hunk','Hunk2','Hunk3','Hunk3 W','Aganta','Aganta W','Lite','Spider','Thermo','Hunk Thermo','Aganta Thermo','Thermo Ked','Travel Thermo','WAVE2 Thermo','Hunk Summer W'];

  function sizeKey(value) {
    var match = String(value || '').trim().match(/^(3[6-9]|4[0-8])(?:\D|$)/);
    return match ? match[1] : '';
  }
  function eligibleSizes(items) {
    var seen = new Set();
    return (items || []).filter(function (item) {
      var size = sizeKey(item.size);
      if (String(item.uid) === UID || FOOTWEAR.indexOf(item.family) < 0 || !size || Number(item.qty || 1) <= 0 || seen.has(size)) return false;
      seen.add(size);
      return true;
    }).map(function (item) { return sizeKey(item.size); });
  }
  function alreadyAdded(items, size) {
    return (items || []).some(function (item) { return String(item.uid) === UID && sizeKey(item.size) === size && Number(item.qty || 1) > 0; });
  }
  function makeItem(product, size) {
    return { uid: UID, title: product.title, photo: product.photo, color_name: '', size: size,
      price: Number(product.price), family: 'Insole', season: null, seasonId: null };
  }
  // Pure helpers are also exercised by Node tests; no DOM or network is needed.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UID: UID, sizeKey: sizeKey, eligibleSizes: eligibleSizes, alreadyAdded: alreadyAdded, makeItem: makeItem };
    return;
  }
  if (typeof CART === 'undefined' || window.ULTERA_INSOLES) return;
  var root = document.getElementById('cdInsoleUpsell');
  if (!root) return;
  var product = null, requested = false, selectedSize = '', pending = false;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function refreshCart() {
    // Preserve checkout visibility when a delayed price lookup completes.
    var list = document.getElementById('cdListWrap');
    var wizard = document.getElementById('cdWizard');
    var listDisplay = list.style.display;
    var wizardDisplay = wizard.style.display;
    renderCart();
    list.style.display = listDisplay;
    wizard.style.display = wizardDisplay;
    if (wizardDisplay !== 'none' && typeof renderSummary === 'function') renderSummary();
  }
  function loadProduct() {
    if (requested) return;
    requested = true;
    fetch('/api/insole-offer', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('unavailable');
      return response.json();
    }).then(function (data) {
      var p = data && data.ok && data.product;
      if (!p || p.uid !== UID || p.family !== 'Insole' || !(Number(p.price) > 0) || !Number.isFinite(Number(p.price))) return;
      product = p;
      var changed = false;
      CART.items.forEach(function (item) {
        if (String(item.uid) === UID && Number(item.price) !== Number(product.price)) {
          item.price = Number(product.price); changed = true;
        }
      });
      if (changed) { CART.save(); refreshCart(); } else render();
    }).catch(function () { root.hidden = true; });
  }
  function render() {
    var sizes = eligibleSizes(CART.items);
    if (!sizes.length) { root.hidden = true; return; }
    if (!product) { root.hidden = true; loadProduct(); return; }
    if (sizes.indexOf(selectedSize) < 0) selectedSize = sizes[0];
    var added = alreadyAdded(CART.items, selectedSize);
    var price = Number(product.price).toLocaleString('uk-UA', { maximumFractionDigits: 2 }) + ' ₴';
    root.replaceChildren();
    var main = element('div', 'cd-insole-main');
    if (product.photo && /^https:\/\//.test(product.photo)) {
      var photo = element('img', 'cd-insole-photo');
      photo.src = product.photo; photo.alt = 'Змінні устілки ULTERA';
      photo.loading = 'lazy'; photo.addEventListener('error', function () { photo.hidden = true; });
      main.appendChild(photo);
    }
    var copy = element('div', 'cd-insole-copy');
    copy.appendChild(element('p', 'cd-insole-eyebrow', 'Доповни свою пару'));
    copy.appendChild(element('h4', 'cd-insole-title', 'Запасна пара устілок'));
    copy.appendChild(element('p', 'cd-insole-text', 'Оригінальні змінні устілки ULTERA. Зручно мати ще одну пару на заміну.'));
    main.appendChild(copy); root.appendChild(main);
    var sizeRow = element('div', 'cd-insole-size');
    if (sizes.length > 1) {
      var label = element('label', '', 'Розмір до твоєї пари');
      label.htmlFor = 'cdInsoleSize'; sizeRow.appendChild(label);
      var select = element('select'); select.id = 'cdInsoleSize';
      sizes.forEach(function (size) {
        var option = element('option', '', 'EU ' + size);
        option.value = size; option.selected = size === selectedSize; select.appendChild(option);
      });
      select.addEventListener('change', function () { selectedSize = select.value; render(); });
      sizeRow.appendChild(select);
    } else sizeRow.textContent = 'Розмір EU ' + selectedSize + ' — як у твоєї пари';
    root.appendChild(sizeRow);
    var add = element('button', 'cd-insole-add', added ? '✓ Устілки EU ' + selectedSize + ' вже в кошику' : 'Додати устілки · ' + price);
    add.type = 'button'; add.disabled = added || pending;
    add.addEventListener('click', function () {
      if (pending || alreadyAdded(CART.items, selectedSize) || eligibleSizes(CART.items).indexOf(selectedSize) < 0) return;
      pending = true; add.disabled = true;
      try {
        CART.add(makeItem(product, selectedSize));
        updateCartBadge();
        if (typeof toast === 'function') toast('Устілки додано до кошика');
      } finally { pending = false; }
      refreshCart();
    });
    root.appendChild(add);
    var status = element('p', 'cd-insole-status', added ? 'Кількість можна змінити у списку товарів вище.' : '1 пара устілок · додається лише за твоїм вибором');
    status.setAttribute('role', 'status'); root.appendChild(status);
    root.hidden = false;
  }
  window.ULTERA_INSOLES = { render: render };
  render();
})();
