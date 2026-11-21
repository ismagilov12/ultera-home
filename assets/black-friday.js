(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const grid = byId('products');
  const sizes = byId('sizes');
  const detail = byId('detail');
  const basketKey = 'ultera_cart';
  const formatter = new Intl.NumberFormat('uk-UA');
  const price = value => formatter.format(value) + ' ₴';
  const escaped = value => String(value ?? '').replace(/[&<>"']/g, symbol => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[symbol]);
  const heroUid = 'bf26-09-ua1-leo-cordura-40';
  const conditionUid = 'bf26-13-ua10-black-boot-42';
  let items = [];
  let activeSize = new URLSearchParams(location.search).get('size') || '';
  let activeDetail = null;
  let noticeTimer;
  let loading = false;

  function basket() {
    const contents = JSON.parse(localStorage.getItem(basketKey) || '[]');
    if (!Array.isArray(contents)) throw new Error('Неможливо прочитати кошик');
    return contents;
  }
  function checkoutLink() {
    const url = new URL('/', location.origin);
    for (const [key, value] of new URLSearchParams(location.search)) {
      if (/^utm_|^(fbclid|gclid|ttclid|campaign_id|adset_id|ad_id)$/.test(key)) url.searchParams.set(key, value);
    }
    url.hash = 'cart';
    return url.href;
  }
  const checkout = checkoutLink();
  document.querySelectorAll('[data-basket]').forEach(link => { link.href = checkout; });

  function syncBasket() {
    let cart;
    try { cart = basket(); } catch { cart = []; }
    byId('cart-count').textContent = String(cart.reduce((n, entry) => n + (Number(entry?.qty) || 1), 0));
    document.querySelectorAll('[data-buy]').forEach(button => {
      const item = items.find(row => row.uid === button.dataset.buy);
      if (!item) return;
      const selected = cart.some(entry => entry.uid === item.uid && String(entry.size) === item.size);
      button.disabled = !item.available;
      button.classList.toggle('in-cart', selected && item.available);
      button.textContent = !item.available ? 'Продано' : selected ? 'До кошика →' : 'У кошик';
      button.setAttribute('aria-label', button.textContent + ' · ' + item.title + ' · EU ' + item.size);
    });
  }
  function showNotice(message, withLink) {
    const notice = byId('notice');
    byId('notice-text').textContent = message;
    notice.querySelector('a').hidden = !withLink;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 7200);
  }
  function add(item) {
    if (!item?.available) return;
    try {
      const cart = basket();
      if (cart.some(entry => entry.uid === item.uid && String(entry.size) === item.size)) {
        location.assign(checkout);
        return;
      }
      const line = {
        uid: item.uid, title: [item.title, item.condition].filter(Boolean).join(' · '),
        photo: new URL(item.photo, location.origin).href, color_name: item.color,
        size: item.size, price: item.price, qty: 1, family: 'SaleOstatki', saleItem: true
      };
      cart.push(line);
      localStorage.setItem(basketKey, JSON.stringify(cart));
      window.trackJourney?.('add_to_cart', line);
      syncBasket();
      if (detail.open) detail.close();
      showNotice(item.title + ' · EU ' + item.size + ' у кошику', true);
    } catch {
      if (detail.open) detail.close();
      showNotice('Не вдалося зберегти кошик у браузері.', false);
    }
  }

  function buyButton(item) {
    return '<button class="buy" type="button" data-buy="' + escaped(item.uid) + '"' + (item.available ? '' : ' disabled') + '>' + (item.available ? 'У кошик' : 'Продано') + '</button>';
  }
  function tile(item, index) {
    const uid = escaped(item.uid), name = escaped(item.title), size = escaped(item.size);
    const mark = !item.available ? '<span class="condition sold">Продано</span>'
      : item.condition ? '<span class="condition">Уцінка</span>' : '';
    const meta = item.article ? 'Арт. ' + escaped(item.article) : '';
    return '<article class="card" id="pair-' + uid + '">' +
      '<button class="product-photo" type="button" data-open="' + uid + '" aria-label="Розглянути ' + name + ', EU ' + size + '">' +
        '<img width="1000" height="1250" loading="' + (index < 4 ? 'eager' : 'lazy') + '" src="' + escaped(item.photo) + '" alt="' + name + ' · ' + escaped(item.color) + '">' +
        '<span class="size-tag">EU ' + size + '</span>' + mark + '</button>' +
      '<div class="card-meta">' + meta + '</div><h3>' + name + '</h3>' +
      '<p class="colour">' + escaped(item.color) + (item.condition ? ' · ' + escaped(item.condition) : '') + '</p>' +
      '<div class="card-action"><span class="price">' + price(item.price) + '</span>' + buyButton(item) + '</div></article>';
  }
  function render() {
    const selection = activeSize ? items.filter(item => item.size === activeSize) : items;
    const available = selection.filter(item => item.available).length;
    byId('result-count').textContent = available + ' у наявності';
    sizes.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(activeSize === button.dataset.size)));
    grid.innerHTML = selection.length ? selection.map(tile).join('') : '<p class="empty">Наразі пар немає.</p>';
    syncBasket();
  }
  function fillSizes() {
    const all = [...new Set(items.map(item => item.size))].sort((a, b) => Number(a) - Number(b));
    if (!all.includes(activeSize)) activeSize = '';
    sizes.innerHTML = ['', ...all].map(size => '<button type="button" data-size="' + escaped(size) + '">' + (escaped(size) || 'Усі') + '</button>').join('');
  }
  function showDetail(item) {
    if (!item) return;
    activeDetail = item.uid;
    const meta = ['EU ' + item.size, item.article && 'Арт. ' + item.article].filter(Boolean).join('  ·  ');
    byId('detail-body').innerHTML = '<div class="detail-photo"><img id="detail-image" src="' + escaped(item.photo) + '" alt="' + escaped(item.title + ' · ' + item.color) + '">' +
      (item.uid === conditionUid ? '<button type="button" class="photo-switch" id="condition-photo">Показати оригінальне фото пари</button>' : '') +
      '</div><div class="detail-copy"><p class="card-meta">' + escaped(meta) + '</p>' +
      (item.condition ? '<p class="flag">' + escaped(item.condition) + '</p>' : '') +
      '<h3 id="detail-title">' + escaped(item.title) + '</h3><p class="colour">' + escaped(item.color) + '</p>' +
      '<div class="card-action"><span class="price">' + price(item.price) + '</span>' + buyButton(item) + '</div></div>';
    if (!detail.open) {
      detail.showModal();
      window.trackJourney?.('product_open', {uid: item.uid, title: item.title, price: item.price});
    }
    syncBasket();
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('/api/black-friday', {cache: 'no-store'});
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('Unavailable');
      if (JSON.stringify(data.items) !== JSON.stringify(items) || !sizes.children.length) {
        items = data.items;
        fillSizes();
        render();
        if (detail.open) {
          const current = items.find(item => item.uid === activeDetail);
          if (current) showDetail(current); else detail.close();
        }
      }
      byId('error').hidden = true;
    } catch {
      byId('error').hidden = false;
      items = [];
      grid.replaceChildren();
      sizes.replaceChildren();
      byId('result-count').textContent = '';
      if (detail.open) detail.close();
    } finally {
      byId('loading').hidden = true;
      loading = false;
    }
  }
  sizes.addEventListener('click', event => {
    const button = event.target.closest('[data-size]');
    if (!button) return;
    activeSize = button.dataset.size;
    const url = new URL(location.href);
    if (activeSize) url.searchParams.set('size', activeSize); else url.searchParams.delete('size');
    history.replaceState(null, '', url);
    render();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-open],[data-buy]');
    if (!button) return;
    const item = items.find(row => row.uid === (button.dataset.open || button.dataset.buy));
    if (button.hasAttribute('data-open')) showDetail(item); else add(item);
  });
  byId('hero-product').addEventListener('click', event => {
    const hero = items.find(item => item.uid === heroUid);
    if (hero) { event.preventDefault(); showDetail(hero); }
  });
  byId('detail-body').addEventListener('click', event => {
    if (event.target.id !== 'condition-photo') return;
    const img = byId('detail-image');
    const original = img.classList.toggle('original');
    img.src = original ? '/photos/black-friday/aganta-condition.jpg' : items.find(item => item.uid === activeDetail).photo;
    event.target.textContent = original ? 'Показати предметне фото' : 'Показати оригінальне фото пари';
  });
  detail.querySelector('.close').addEventListener('click', () => detail.close());
  detail.addEventListener('click', event => { if (event.target === detail) detail.close(); });
  byId('notice').querySelector('button').addEventListener('click', () => { byId('notice').hidden = true; });
  byId('retry').addEventListener('click', refresh);
  window.addEventListener('pageshow', () => { syncBasket(); refresh(); });
  window.addEventListener('storage', event => { if (event.key === basketKey) syncBasket(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncBasket(); refresh(); } });
  syncBasket();
  refresh();
})();
