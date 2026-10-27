/* ULTERA Hunk3 All Black: detailed turntable, isolated from other products. */
(() => {
  'use strict';
  const ROTATION = {
    uid: '809858137952',
    atlas: '/assets/catalog360/atlases/809858137952-v2-20261027.webp',
    frames: 8,
    cols: 4,
    rows: 2,
    frameMs: 950,
    background: '#f0f0f0',
    contentWidthRatio: 0.90,
    contentHeightRatio: 0.78,
    baselineRatio: 0.83,
    frameSize: 1254,
    // Measured once from the finished atlas; no pixel scan on the main thread.
    bounds: [
      { left: 19, right: 1234, top: 383, bottom: 968, background: 'rgb(234,234,234)' },
      { left: 35, right: 1221, top: 326, bottom: 1038, background: 'rgb(233,233,233)' },
      { left: 295, right: 958, top: 261, bottom: 1048, background: 'rgb(231,231,231)' },
      { left: 40, right: 1216, top: 355, bottom: 1010, background: 'rgb(234,234,234)' },
      { left: 29, right: 1229, top: 382, bottom: 968, background: 'rgb(232,232,232)' },
      { left: 101, right: 1178, top: 336, bottom: 1080, background: 'rgb(231,231,231)' },
      { left: 328, right: 921, top: 286, bottom: 1047, background: 'rgb(231,231,231)' },
      { left: 48, right: 1194, top: 300, bottom: 1055, background: 'rgb(232,232,232)' },
    ],
  };
  const wrap = document.getElementById('m_img_wrap');
  const photo = document.getElementById('m_img');
  const title = document.getElementById('m_title');
  const actions = document.getElementById('m_rotation_actions');
  const modal = document.getElementById('modal');
  if (!wrap || !photo || !title || !actions || !modal) return;

  const style = document.createElement('style');
  style.textContent = `
    #hunk360Toggle{position:static;border:0;border-radius:24px;padding:12px 20px;background:#caff00;color:#151515;font:700 12px/1.2 Arial,sans-serif;letter-spacing:.5px;white-space:nowrap;cursor:pointer;box-shadow:0 3px 14px #0002}
    #hunk360Toggle[hidden],#hunk360Canvas[hidden],#hunk360Controls[hidden]{display:none!important}
    #hunk360Canvas{position:absolute;inset:0;width:100%;height:100%;z-index:14;touch-action:pan-y;cursor:grab}
    #hunk360Canvas[data-dragging="true"]{cursor:grabbing}
    #hunk360Controls{display:flex;align-items:center;gap:8px;padding:4px 8px;background:#fffffff2;box-shadow:0 2px 12px #0002;border-radius:24px;color:#171717;font:600 12px Arial,sans-serif;white-space:nowrap}
    #hunk360Controls button{border:0;background:transparent;border-radius:50%;width:36px;height:36px;cursor:pointer;color:#171717;font:700 20px Arial,sans-serif}
    #hunk360Toggle:focus-visible,#hunk360Controls button:focus-visible,#hunk360Canvas:focus-visible{outline:2px solid #151515;outline-offset:3px}
    #m_img_wrap[data-hunk-rotation="active"]>#m_counter_pill,#m_img_wrap[data-hunk-rotation="active"]>#m_dots,#m_img_wrap[data-hunk-rotation="active"]>.m-nav,#m_img_wrap[data-hunk-rotation="active"]>.m-zone{visibility:hidden;pointer-events:none}
  `;
  document.head.appendChild(style);
  const button = document.createElement('button');
  button.id = 'hunk360Toggle';
  button.type = 'button';
  button.textContent = '↻ Обернути 360°';
  button.setAttribute('aria-pressed', 'false');
  button.hidden = true;
  actions.appendChild(button);
  const controls = document.createElement('div');
  controls.id = 'hunk360Controls';
  controls.hidden = true;
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Керування обертанням Hunk3 All Black');
  controls.innerHTML = '<button type="button" aria-label="Попередній ракурс 360°">‹</button><button type="button" aria-label="Призупинити обертання">Ⅱ</button><span aria-live="off">1 / 8</span><button type="button" aria-label="Наступний ракурс 360°">›</button>';
  actions.appendChild(controls);
  const [previous, play, next] = controls.querySelectorAll('button');
  const label = controls.querySelector('span');
  const canvas = document.createElement('canvas');
  canvas.id = 'hunk360Canvas';
  canvas.hidden = true;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Hunk3 All Black: огляд на 360 градусів');
  canvas.setAttribute('title', 'Проведіть ліворуч або праворуч для обертання');
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { button.remove(); controls.remove(); canvas.remove(); return; }
  ctx.imageSmoothingQuality = 'high';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, running = false, raf = 0, last = 0, frame = 0;
  let atlas = null, loading = null, pending = false, views = [], version = 0;
  let maxShoeWidth = 1, maxShoeHeight = 1;
  let savedVisibility = '', savedBackground = '', pointer = null;

  function eligible() {
    const selected = String(window.__modalUid || '');
    return (!selected || selected === ROTATION.uid) &&
      wrap.dataset.fam === 'Hunk3' && /ALL\s*BLACK/i.test(title.textContent);
  }

  // One scale is shared by every angle, so narrow front/rear views are never
  // enlarged. Bounds exclude the pale floor and shadow and are prepared offline.
  function inspectViews(im) {
    const w = im.naturalWidth / ROTATION.cols;
    const h = im.naturalHeight / ROTATION.rows;
    if (w !== ROTATION.frameSize || h !== ROTATION.frameSize || ROTATION.bounds.length !== ROTATION.frames) {
      throw new Error('Hunk3 atlas dimensions do not match its prepared bounds');
    }
    const result = ROTATION.bounds.map((bounds, i) => ({
      ...bounds, x: (i % ROTATION.cols) * w, y: Math.floor(i / ROTATION.cols) * h, w, h,
    }));
    maxShoeWidth = Math.max(...result.map(v => v.right - v.left + 1));
    maxShoeHeight = Math.max(...result.map(v => v.bottom - v.top + 1));
    views = result;
  }

  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => {
        try { inspectViews(im); atlas = im; resolve(); }
        catch (error) { loading = null; reject(error); }
      };
      im.onerror = () => { loading = null; reject(new Error('Hunk3 rotation unavailable')); };
      im.src = ROTATION.atlas;
    });
    return loading;
  }

  function render() {
    const v = views[frame];
    if (!v || !active) return;
    const rect = wrap.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    if (!(width > 0 && height > 0)) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.imageSmoothingQuality = 'high';
    }
    // Fit the actual desktop/mobile viewport while preserving one physical
    // scale for the entire turntable, including narrow front and rear views.
    const scale = Math.min(
      width * ROTATION.contentWidthRatio / maxShoeWidth,
      height * ROTATION.contentHeightRatio / maxShoeHeight,
    );
    const background = v.background || ROTATION.background;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(atlas, v.x, v.y, v.w, v.h,
      width / 2 - (v.left + v.right + 1) / 2 * scale,
      height * ROTATION.baselineRatio - (v.bottom + 1) * scale,
      v.w * scale, v.h * scale);
    wrap.style.backgroundColor = background;
    canvas.dataset.frame = String(frame);
    label.textContent = `${frame + 1} / ${ROTATION.frames}`;
    canvas.setAttribute('aria-label', `Hunk3 All Black · ракурс ${frame + 1} з ${ROTATION.frames}`);
  }

  function tick(time) {
    if (!active || !running) return;
    if (!last) last = time;
    const elapsed = time - last;
    if (elapsed >= ROTATION.frameMs) {
      frame = (frame + Math.floor(elapsed / ROTATION.frameMs)) % ROTATION.frames;
      last = time - elapsed % ROTATION.frameMs;
      render();
    }
    raf = requestAnimationFrame(tick);
  }

  function playback(value) {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    running = active && value;
    const symbol = running ? 'Ⅱ' : '▶';
    const description = running ? 'Призупинити обертання' : 'Продовжити обертання';
    if (play.textContent !== symbol) play.textContent = symbol;
    if (play.getAttribute('aria-label') !== description) play.setAttribute('aria-label', description);
    if (running) raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!active && !running && !pending) return;
    version++;
    pending = false;
    playback(false);
    if (active) {
      photo.style.visibility = savedVisibility;
      wrap.style.backgroundColor = savedBackground;
    }
    active = false; pointer = null;
    delete canvas.dataset.dragging;
    delete wrap.dataset.hunkRotation;
    canvas.hidden = true; controls.hidden = true;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '↻ Обернути 360°';
  }

  function sync() {
    const hidden = !eligible();
    if (button.hidden !== hidden) button.hidden = hidden;
    if (hidden || !modal.classList.contains('open')) stop();
  }

  function step(delta) {
    if (!active) return;
    playback(false);
    frame = (frame + delta + ROTATION.frames) % ROTATION.frames;
    render();
  }

  previous.onclick = event => { event.stopPropagation(); step(-1); };
  next.onclick = event => { event.stopPropagation(); step(1); };
  play.onclick = event => { event.stopPropagation(); if (active) playback(!running); };
  button.onclick = async event => {
    event.preventDefault(); event.stopPropagation();
    if (active) { stop(); return; }
    if (!eligible() || !modal.classList.contains('open')) return;
    const requested = ++version;
    pending = true;
    button.disabled = true;
    button.textContent = 'Завантаження 360°…';
    try {
      await load();
      if (requested !== version || !eligible() || !modal.classList.contains('open')) return;
      if (window.__hun3IntroActive && typeof window.hun3IntroSkip === 'function') window.hun3IntroSkip();
      savedVisibility = photo.style.visibility;
      savedBackground = wrap.style.backgroundColor;
      active = true; frame = 0;
      photo.style.visibility = 'hidden';
      canvas.hidden = false; controls.hidden = false;
      wrap.dataset.hunkRotation = 'active';
      button.setAttribute('aria-pressed', 'true');
      button.textContent = '✕ Повернути фото';
      render(); playback(!motion.matches);
    } catch {
      if (requested === version && eligible()) button.textContent = 'Повторити 360°';
    } finally { pending = false; button.disabled = false; }
  };

  document.addEventListener('keydown', event => {
    if (!active || !modal.classList.contains('open')) return;
    const tag = event.target && event.target.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || event.target?.isContentEditable) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); event.stopImmediatePropagation();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Escape') stop();
  }, true);

  canvas.addEventListener('pointerdown', event => {
    if (!active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, frame, dragging: false };
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || !active) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!pointer.dragging) {
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
      pointer.dragging = true; playback(false);
      canvas.dataset.dragging = 'true';
      canvas.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const pixels = Math.max(24, canvas.getBoundingClientRect().width / ROTATION.frames);
    frame = ((pointer.frame - Math.round(dx / pixels)) % ROTATION.frames + ROTATION.frames) % ROTATION.frames;
    render();
  });
  function releasePointer(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointer = null; delete canvas.dataset.dragging;
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('click', event => { event.stopPropagation(); });
  // The original gallery also listens for touch swipes on the parent. Keep its
  // gallery index intact while the user is manipulating the turntable.
  for (const name of ['touchstart', 'touchend', 'touchcancel']) {
    canvas.addEventListener(name, event => { if (active) event.stopPropagation(); }, { passive: true });
  }
  new MutationObserver(() => { stop(); sync(); }).observe(photo, { attributes: true, attributeFilter: ['src'] });
  new MutationObserver(sync).observe(title, { childList: true, subtree: true, characterData: true });
  new MutationObserver(sync).observe(wrap, { attributes: true, attributeFilter: ['data-fam'] });
  new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) playback(false); });
  if (motion.addEventListener) motion.addEventListener('change', () => { if (motion.matches) playback(false); });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (active) render(); }).observe(wrap);
  } else {
    window.addEventListener('resize', () => { if (active) render(); });
  }
  sync();
})();
