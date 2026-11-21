(() => {
  const section = document.getElementById('catalog');
  const grid = document.getElementById('regular-grid');
  const template = document.getElementById('regular-card');
  const filters = document.getElementById('regular-filters');
  const status = document.getElementById('regular-status');
  const error = document.getElementById('regular-error');
  const currency = new Intl.NumberFormat('uk-UA');
  const plural = new Intl.PluralRules('uk-UA');
  const modelForms = {one:'модель', few:'моделі', many:'моделей', other:'моделі'};
  let families = [];
  let gender = 'all';
  let pending = false;
  let positionInitialLink = () => {};

  const storeUrl = new URL('/', location.origin);
  for (const [key, value] of new URLSearchParams(location.search)) {
    if (/^utm_|^(fbclid|gclid|ttclid|campaign_id|adset_id|ad_id)$/.test(key)) storeUrl.searchParams.set(key, value);
  }

  function makeCard(family, variants) {
    const card = template.content.firstElementChild.cloneNode(true);
    const photoLink = card.querySelector('.regular-photo');
    const image = photoLink.querySelector('img');
    const open = card.querySelector('.regular-open');
    const swatches = card.querySelector('.regular-swatches');
    const color = card.querySelector('.regular-color');
    const price = card.querySelector('.regular-price');
    card.dataset.family = family.family;
    card.querySelector('h3').textContent = family.name;
    swatches.setAttribute('aria-label', 'Колір ' + family.name);
    image.addEventListener('load', () => {
      image.classList.toggle('landscape', image.naturalWidth > 1.15 * image.naturalHeight);
    });

    function choose(variant) {
      const url = new URL(storeUrl);
      url.searchParams.set('p', variant.uid);
      photoLink.href = open.href = url.href;
      image.src = variant.photo;
      image.alt = family.name + ' — ' + variant.color;
      color.textContent = variant.color;
      price.textContent = currency.format(variant.price) + ' ₴';
      open.textContent = variant.available ? 'Обрати розмір' : 'Переглянути модель';
      open.setAttribute('aria-label', open.textContent + ' — ' + image.alt);
      for (const button of swatches.children) {
        button.setAttribute('aria-pressed', String(button.dataset.uid === variant.uid));
      }
    }

    for (const variant of variants) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.uid = variant.uid;
      button.setAttribute('aria-label', variant.color);
      button.title = variant.color;
      const chip = document.createElement('i');
      // Swatches in the shop are either a solid colour or a multicolour gradient.
      if (CSS.supports('color', variant.swatch) || /^linear-gradient\([#\w\d%,.\s-]+\)$/i.test(variant.swatch)) {
        chip.style.setProperty('--tone', variant.swatch);
      }
      button.append(chip);
      button.addEventListener('click', () => choose(variant));
      swatches.append(button);
    }
    choose(variants.find(variant => variant.available) || variants[0]);
    return card;
  }

  function render() {
    const cards = [];
    for (const family of families) {
      const variants = family.variants.filter(v => gender === 'all' || v.gender === gender || v.gender === 'unisex');
      if (variants.length) cards.push(makeCard(family, variants));
    }
    grid.replaceChildren(...cards);
    status.textContent = cards.length ? cards.length + ' ' + modelForms[plural.select(cards.length)] : 'Моделей поки немає.';
    for (const button of filters.children) {
      button.setAttribute('aria-pressed', String(button.dataset.gender === gender));
    }
  }

  async function load() {
    if (pending) return;
    pending = true;
    error.hidden = true;
    status.textContent = 'Завантажуємо каталог…';
    try {
      const response = await fetch('/api/storefront-catalog');
      if (!response.ok) throw new Error('Catalogue unavailable');
      const data = await response.json();
      if (!Array.isArray(data.families)) throw new Error('Invalid catalogue');
      families = data.families;
      render();
      filters.hidden = !families.length;
    } catch {
      status.textContent = '';
      error.hidden = false;
    } finally {
      pending = false;
      positionInitialLink();
    }
  }
  filters.addEventListener('click', event => {
    const button = event.target.closest('button[data-gender]');
    if (button && gender !== button.dataset.gender) {
      gender = button.dataset.gender;
      render();
    }
  });
  document.getElementById('regular-retry').addEventListener('click', load);
  // The clearance grid above arrives asynchronously. Keep a direct catalogue link
  // anchored to the heading after that grid takes up its final space.
  if (location.hash === '#catalog') {
    const saleLoading = document.getElementById('loading');
    const observer = new MutationObserver(() => positionInitialLink());
    const input = new AbortController();
    function cancel() { observer.disconnect(); input.abort(); positionInitialLink = () => {}; }
    positionInitialLink = () => {
      if (pending || !saleLoading.hidden) return;
      requestAnimationFrame(() => {
        if (!input.signal.aborted && location.hash === '#catalog') section.scrollIntoView({behavior:'instant'});
        cancel();
      });
    };
    for (const name of ['wheel', 'pointerdown', 'keydown']) {
      window.addEventListener(name, cancel, {once:true, passive:true, signal:input.signal});
    }
    observer.observe(saleLoading, {attributes:true, attributeFilter:['hidden']});
  }
  load();
})();
