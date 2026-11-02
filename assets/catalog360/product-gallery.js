/* ULTERA product-card media. The ordinary gallery owns its index and all swipes.
 * 360 is a cancellable overlay; it never replaces a photo URL or touches the cart. */
(() => {
  'use strict';

  // Original, measured Hunk3 v2 atlas calibration. Keep one physical scale across
  // all eight angles instead of stretching the narrow front/back views.
  const HUNK_ATLAS = 'atlases/809858137952-v2-20261027.webp';
  const HUNK = [
    [19,383,1234,968,234],[35,326,1221,1038,233],[295,261,958,1048,231],
    [40,355,1216,1010,234],[29,382,1229,968,232],[101,336,1178,1080,231],
    [328,286,921,1047,231],[48,300,1194,1055,232]
  ].map(([x,y,r,b,grey]) => ({x,y,width:r-x+1,height:b-y+1,bg:'rgb('+[grey,grey,grey]+')'}));
  const maxHunkWidth = Math.max(...HUNK.map(b=>b.width));
  const maxHunkHeight = Math.max(...HUNK.map(b=>b.height));

  function indexManifest(rows) {
    const entries = new Map();
    if (!Array.isArray(rows)) return entries;
    for (const e of rows) {
      if (!e || !e.uid || e.status!=='prepared' || typeof e.atlas!=='string' ||
          !Number.isInteger(e.frames) || e.frames<2 || e.frames>120 ||
          !Number.isInteger(e.cols) || !Number.isInteger(e.rows) ||
          e.cols<1 || e.rows<1 || e.cols*e.rows<e.frames) continue;
      entries.set(String(e.uid),e);
      for (const alias of e.aliases||[]) entries.set(String(alias),e);
    }
    return entries;
  }

  function frameLayout(entry, image, frame, width, height) {
    const w=image.naturalWidth/entry.cols,h=image.naturalHeight/entry.rows;
    if (!(w>0 && h>0 && width>0 && height>0) || frame<0 || frame>=entry.frames) {
      throw Error('Invalid turntable dimensions');
    }
    const sx=frame%entry.cols*w,sy=Math.floor(frame/entry.cols)*h;
    const hunk=entry.atlas===HUNK_ATLAS && String(entry.uid)==='809858137952';
    if (hunk && (w!==1254 || h!==1254 || entry.frames!==8)) throw Error('Hunk3 atlas mismatch');
    const b=hunk ? HUNK[frame] : entry.bounds?.[frame];
    if (b && b.width>0 && b.height>0) {
      const scale=hunk ? Math.min(width*.9/maxHunkWidth,height*.78/maxHunkHeight)
                       : Math.min(width*(820/900)/b.width,height*(480/1125)/b.height);
      return {
        bg:(hunk ? b.bg : entry.backgrounds?.[frame])||'#eeeeec',
        draw:[sx,sy,w,h,width/2-(b.x+b.width/2)*scale,
          height*(hunk ? .83 : 820/1125)-(b.y+b.height)*scale,w*scale,h*scale]
      };
    }
    // First-generation atlases have no measured bounds; trim tile seams.
    const inset=Math.min(4,w/8,h/8),cw=w-2*inset,ch=h-2*inset;
    const scale=Math.min(width/cw,height*.91/ch),dw=cw*scale,dh=ch*scale;
    return {bg:'#eeeeec',draw:[sx+inset,sy+inset,cw,ch,(width-dw)/2,height*(880/1125)-dh*.78,dw,dh]};
  }

  function createPlayer(io) {
    let entries=new Map(), uid='', state='photo', epoch=0, timer=null, frame=0, atlas=null;
    const current=()=>entries.get(uid);
    const update=()=>io.state(state,current());
    function stop() {
      ++epoch;
      if (timer!==null) io.cancel(timer);
      timer=null; atlas=null; frame=0; state='photo'; update();
    }
    function select(id) { uid=String(id||''); stop(); }
    async function toggle() {
      if (state!=='photo') { stop(); return; }
      const item=current();
      if (!item || !io.visible()) return;
      io.prepare(); // Pause/leave video before starting a request, not after navigation.
      const token=++epoch;
      state='loading'; update();
      try {
        const im=await io.load(item);
        if (token!==epoch || item!==current()) return;
        if (!io.visible()) { stop(); return; }
        atlas=im; frame=0;
        io.paint(item,atlas,frame);
        state='360'; update();
        // Animation is opt-in by an explicit click even in reduced-motion mode.
        // Use a gentler cadence there, no interpolated transitions, and an immediate exit.
        timer=io.schedule(()=>{
          if (token!==epoch || !io.visible()) { if (token===epoch) stop(); return; }
          frame=(frame+1)%item.frames;
          io.paint(item,atlas,frame);
        },io.delay(item));
      } catch (_) {
        if (token===epoch) { stop(); io.failure(); }
      }
    }
    return {
      select, stop, toggle,
      setManifest(rows) { entries=indexManifest(rows); stop(); },
      resize() { if(state==='360' && atlas && io.visible()) io.paint(current(),atlas,frame); }
    };
  }

  if (typeof module==='object' && module.exports) module.exports={indexManifest,frameLayout,createPlayer};
  if (typeof document==='undefined') return;
  const script=document.currentScript, wrap=document.getElementById('m_img_wrap'),
    modal=document.getElementById('modal'),canvas=document.getElementById('ultera360Canvas'),
    btn=document.getElementById('ultera360Button');
  if (!script || !wrap || !modal || !canvas || !btn) return;
  const ctx=canvas.getContext('2d');
  if (!ctx) return;
  const base=new URL('.',script.src), label=btn.querySelector('.lbl'), icon=btn.querySelector('.play');
  const cache=new Map(),motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const visible=()=>modal.classList.contains('open') && !document.hidden;
  function load(entry) {
    const url=new URL(entry.atlas,base);
    if (url.origin!==base.origin) return Promise.reject(Error('Unexpected atlas origin'));
    if (!cache.has(url.href)) {
      const promise=new Promise((resolve,reject)=>{
        const im=new Image(); im.decoding='async';
        im.onload=()=>resolve(im);
        im.onerror=()=>reject(Error('Atlas unavailable'));
        im.src=url.href;
      }).catch(err=>{cache.delete(url.href);throw err;});
      cache.set(url.href,promise);
    }
    return cache.get(url.href);
  }
  const player=createPlayer({
    visible,load,
    prepare() {
      if (window.__hun3IntroActive) window.hun3IntroSkip?.();
      if (window.__shapeIntroActive) window.shapeIntroSkip?.();
      const src=(window.__modalPhotos||[])[window.__modalPhotoIdx||0];
      if (window.ulteraGalleryMedia?.isVideo(src)) window.moveModalPhoto(-1);
    },
    paint(entry,im,frame) {
      const box=wrap.getBoundingClientRect(),w=box.width,h=box.height;
      const layout=frameLayout(entry,im,frame,w,h);
      const dpr=Math.min(2,window.devicePixelRatio||1);
      const pw=Math.max(1,Math.round(w*dpr)),ph=Math.max(1,Math.round(h*dpr));
      if (canvas.width!==pw || canvas.height!==ph) {canvas.width=pw;canvas.height=ph;}
      ctx.setTransform(pw/w,0,0,ph/h,0,0);
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.fillStyle=layout.bg;ctx.fillRect(0,0,w,h);ctx.drawImage(im,...layout.draw);
      canvas.dataset.frame=String(frame);
    },
    state(state,entry) {
      const active=state==='360',loading=state==='loading';
      wrap.dataset.galleryView=state;
      canvas.hidden=!active;
      btn.hidden=!entry;
      btn.setAttribute('aria-pressed',String(active));
      btn.setAttribute('aria-busy',String(loading));
      btn.setAttribute('aria-label',active?'Повернутися до фото':loading?'Скасувати завантаження 360°':'Увімкнути обертання на 360°');
      btn.title=btn.getAttribute('aria-label');
      label.textContent=active?'До фото':loading?'360°…':'360°';
      icon.textContent=active?'×':'↻';
      if (active) canvas.setAttribute('aria-label',entry.name+' · огляд на 360°');
    },
    failure() { window.toast?.('Не вдалося завантажити 360°. Фото доступні, спробуйте ще раз.'); },
    delay:entry=>Math.max(motion.matches?1400:0,entry.atlas===HUNK_ATLAS?950:1250),
    schedule:(fn,ms)=>window.setInterval(fn,ms),cancel:id=>window.clearInterval(id)
  });
  window.ulteraCard360=player;
  btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();player.toggle();});
  new MutationObserver(()=>{if(!modal.classList.contains('open'))player.stop();})
    .observe(modal,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',()=>{if(document.hidden) player.stop();});
  document.addEventListener('keydown',e=>{
    if (e.key==='Escape' && visible() && wrap.dataset.galleryView!=='photo') {
      e.preventDefault();e.stopImmediatePropagation();player.stop();btn.focus({preventScroll:true});
    }
  },true);
  if (typeof ResizeObserver==='function') new ResizeObserver(()=>player.resize()).observe(wrap);
  else window.addEventListener('resize',()=>player.resize());
  // Preserve the existing SHAPE URL aliases for catalog cards, independent of 360 availability.
  const shapeCanonical={'sh-black':'970030589784','sh-beige':'450276762874','sh-pistachio':'482851122304','sh-blue':'184767423395','sh-burgundy':'621792744368','sh-gray':'329608071197','sh-orange':'255434553144','sh-red':'247156876545'};
  document.addEventListener('click',e=>{
    const card=e.target.closest?.('.feat-card[data-fam="SHAPE"]');
    if (!card || e.target.closest('.sw,.feat-colors-tr') || !e.target.closest('.feat-discover,.feat-right')) return;
    if (shapeCanonical[card.dataset.activeUid]) card.dataset.activeUid=shapeCanonical[card.dataset.activeUid];
  },true);
  player.select(window.__modalUid);
  fetch(new URL('manifest.json',base),{cache:'no-store'})
    .then(r=>{if(!r.ok)throw Error('Manifest unavailable');return r.json();})
    .then(rows=>player.setManifest(rows))
    .catch(()=>player.setManifest([]));
})();
