(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const grid = byId('products');
  const sizes = byId('sizes');
  const detail = byId('detail');
  const guide = byId('guide');
  const zoom = byId('zoom');
  const formatter = new Intl.NumberFormat('uk-UA');
  const money = value => formatter.format(value) + ' ₴';
  const articleLabel = item => item.article ? 'Арт. ' + item.article : 'Артикул уточнюється';
  const centimeters = cm => cm > 0 ? formatter.format(cm) + ' см' : '';
  const sizeLabel = item => ['EU ' + item.size, centimeters(item.cm)].filter(Boolean).join(' · ');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);

  // Coordinates locate real construction details in each warehouse photograph.
  // Catalogue prices, sizes and availability always come from the live endpoint.
  const notes = {
    'bf26-01-ua3-black-45': {
      kind:'Кросівки', tone:'#292b2b', studio:[61.6,2.30], detail:'Сітка й накладки', focus:[52,67,215], rank:9,
      description:'Чорна сітка проглядає між накладками. Уздовж підошви йде тонка ребриста смуга.'
    },
    'bf26-02-ua11-blue-mesh-42': {
      kind:'Кросівки', tone:'#6aaed8', studio:[61.2,2.30], detail:'Блакитна сітка', focus:[51,65,230], rank:4,
      description:'Світлі хвилясті накладки обрамляють блакитну сітку. У білій підошві видно ряд овальних прорізів.'
    },
    'bf26-03-cros31-cordura-40': {
      kind:'Кросівки', tone:'#282c2d', studio:[59.2,2.15], detail:'Фактура Cordura', focus:[29,65,220], rank:11,
      description:'Чорний верх із петлею на п’яті. На білій підошві чергуються гладкі та рифлені ділянки.'
    },
    'bf26-05-sp10-grey-suede-42': {
      kind:'Кеди', tone:'#878781', studio:[64.2,2.44], detail:'Перфорація замші', focus:[50,66,235], rank:5,
      description:'Сіра замша з дрібною перфорацією збоку. Хвиляста строчка повторює контур носка.'
    },
    'bf26-06-spider-mesh-41': {
      kind:'Кросівки', tone:'#323637', studio:[60,2.2], detail:'Сітчаста вставка', focus:[52,64,222], rank:12,
      description:'Чорна сітка утворює великі бічні вставки. На білій підошві видно діагональні ребра.'
    },
    'bf26-07-slip-on-black-suede-42': {
      kind:'Сліпони', tone:'#252526', studio:[64.2,2.70], detail:'Чорна замша', focus:[53,68,225], rank:6,
      description:'Низький задник і суцільний верх без шнурівки. На білій підошві помітні тонкі горизонтальні лінії.'
    },
    'bf26-08-ua1-olive-mesh-44': {
      kind:'Кросівки', tone:'#757553', studio:[66.4,2.20], detail:'Сітка й накладки', focus:[54,67,225], rank:10,
      description:'Оливкові накладки перетинають сіру сітку. На білій підошві — геометричний рельєф.'
    },
    'bf26-09-ua1-leo-cordura-40': {
      kind:'Кросівки', tone:'linear-gradient(135deg,#a27c4b 50%,#382e25 50%)', studio:[59.4,2.04], detail:'Леопардовий візерунок', focus:[28,62,220], rank:1,
      description:'Леопардовий малюнок переходить із п’яти на носок. Уздовж коміра видно яскраво-рожеву підкладку.'
    },
    'bf26-10-ua10-oreo-black-sole-42': {
      kind:'Кросівки', tone:'linear-gradient(135deg,#f3f3ef 47%,#28292a 47%)', studio:[64,2.15], detail:'Бічна смуга ULTERA', focus:[48,65,210], rank:2,
      description:'Біла бічна смуга з написом ULTERA огинає чорний верх. Довгі петлі формують шнурівку.'
    },
    'bf26-11-ua11-wine-cordura-42': {
      kind:'Кросівки', tone:'#713442', studio:[61.4,1.96], detail:'Бордова Cordura', focus:[50,63,220], rank:7,
      description:'Бордові вставки окреслені чорними хвилястими накладками. Уздовж чорної підошви — ряд овальних прорізів.'
    },
    'bf26-12-ua1-pistachio-boot-42': {
      kind:'Черевики', tone:'#c8d4aa', studio:[57.2,1.63], detail:'Високий комір', focus:[35,52,215], rank:3,
      description:'Фісташкові та чорні панелі сходяться біля високого коміра з тонким рожевим кантом.'
    },
    'bf26-13-ua10-black-boot-42': {
      kind:'Черевики', tone:'#242727', studio:[64.8,1.80], detail:'Петельна шнурівка', focus:[48,62,218], rank:13, original:'/photos/black-friday/aganta-condition.jpg',
      description:'Чорний верх із петельною шнурівкою. На підошві видно хвилясту лінію від п’яти до носка.'
    },
    'bf26-14-ua1-mint-40': {
      kind:'Кросівки', tone:'linear-gradient(135deg,#b2e7d9 50%,#35afba 50%)', studio:[60.2,2.08], detail:'Бічні панелі', focus:[50,65,220], rank:8,
      description:'М’ятні й бірюзові панелі обрамляють чорну трикутну вставку. На білій підошві — рельєфні смуги.'
    },
    'bf26-15-ua1-black-high-top-40': {
      kind:'Високі кеди', tone:'#22252a', studio:[60.2,1.72], detail:'Високий комір', focus:[37,60,210], rank:14,
      description:'Чорний високий верх із широким коміром. Під темною підошвою видно коричневий зубчастий протектор.'
    }
  };
  const heroUid = 'bf26-02-ua11-blue-mesh-42';
  const viewNames = {studio:'На білому', macro:'Деталь', actual:'Фото пари'};
  const basketKey = 'ultera_cart';
  let items = [], activeSize = '', sort = 'edit', activeUid = null, activeView = 'studio';
  let loading = false, hasLoaded = false, noticeTimer, gesture;

  function basket() {
    const contents = JSON.parse(localStorage.getItem(basketKey) || '[]');
    if (!Array.isArray(contents)) throw new Error('Неможливо прочитати кошик');
    return contents;
  }
  const checkout = new URL('/', location.origin);
  for (const [key,value] of new URLSearchParams(location.search)) {
    if (/^utm_|^(fbclid|gclid|ttclid|campaign_id|adset_id|ad_id)$/.test(key)) checkout.searchParams.set(key,value);
  }
  checkout.hash = 'cart';
  document.querySelectorAll('[data-basket]').forEach(link => { link.href = checkout.href; });

  function original(item) {
    const note = notes[item.uid];
    if (!note) return null;
    return note.original || item.photo.replace('/black-friday/', '/black-friday/pairs/').replace(/\.webp$/, '.jpg');
  }
  const viewsFor = item => original(item) ? ['studio','macro','actual'] : ['studio'];
  const itemFor = uid => items.find(item => item.uid === uid);
  function visual(item, view, lazy = true, decorate = false, withCaption = false) {
    const source = view === 'studio' ? item.photo : original(item);
    const [x,y,scale] = notes[item.uid]?.focus || [50,65,210];
    const [center,aspect] = notes[item.uid]?.studio || [61,2];
    const style = view === 'macro' ? ' style="--fx:-'+x+'%;--fy:-'+y+'%;--zoom:'+scale+'%"'
      : view === 'studio' ? ' style="--center:-'+center+'%;--aspect:'+aspect+'"' : '';
    const description = decorate ? '' : [viewNames[view], notes[item.uid]?.kind, articleLabel(item), item.color].filter(Boolean).join(' · ');
    const caption = withCaption && view === 'macro' && notes[item.uid] ? '<span class="macro-caption">'+escape(notes[item.uid].detail)+'</span>' : '';
    return '<span class="visual '+view+'"'+style+'><img loading="'+(lazy?'lazy':'eager')+'" decoding="async" width="'+(view==='studio'?1000:960)+'" height="'+(view==='studio'?1250:1280)+'" src="'+escape(source)+'" alt="'+escape(description)+'">'+caption+'</span>';
  }
  function buyButton(item) {
    return '<button class="buy" type="button" data-buy="'+escape(item.uid)+'"'+(item.available?'':' disabled')+'>'+ (item.available?'У кошик':'Продано')+'</button>';
  }
  function syncBasket() {
    let cart;
    try { cart=basket(); } catch { cart=[]; }
    byId('cart-count').textContent = String(cart.reduce((sum,x)=>sum+(Number(x?.qty)||1),0));
    document.querySelectorAll('[data-buy]').forEach(button => {
      const item=itemFor(button.dataset.buy);
      if(!item) return;
      const selected=cart.some(line=>line.uid===item.uid && String(line.size)===item.size);
      button.disabled=!item.available;
      button.classList.toggle('in-cart', selected && item.available);
      button.textContent = !item.available?'Продано':selected?'До кошика':'У кошик';
      button.setAttribute('aria-label',[button.textContent, articleLabel(item), item.color, sizeLabel(item)].join(' · '));
    });
  }
  function notice(message, withLink) {
    byId('notice-text').textContent=message;
    byId('notice').querySelector('a').hidden=!withLink;
    byId('notice').hidden=false;
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{byId('notice').hidden=true;},6500);
  }
  function add(item) {
    if(!item?.available) return;
    try {
      const cart=basket();
      if(cart.some(line=>line.uid===item.uid && String(line.size)===item.size)) {
        location.assign(checkout.href);
        return;
      }
      const line={uid:item.uid,title:[articleLabel(item),item.condition].filter(Boolean).join(' · '),
        photo:new URL(item.photo,location.origin).href,color_name:item.color,
        size:item.size,price:item.price,qty:1,family:'SaleOstatki',saleItem:true};
      cart.push(line);
      localStorage.setItem(basketKey,JSON.stringify(cart));
      window.trackJourney?.('add_to_cart',line);
      syncBasket();
      if(detail.open) closeProduct();
      notice(articleLabel(item)+' · '+sizeLabel(item)+' у кошику',true);
    } catch {
      if(detail.open) closeProduct();
      notice('Не вдалося зберегти кошик у браузері.',false);
    }
  }
  function colour(item) {
    const tone=notes[item.uid]?.tone || '#51595c';
    return '<p class="colour"><i class="swatch" aria-hidden="true" style="--tone:'+tone+'"></i><span>'+escape(item.color)+'</span></p>';
  }
  function seasonLine(item) {
    return '<p class="pair-season"><span>Сезон</span> <strong>'+escape(item.season || 'Уточнюється')+'</strong></p>';
  }
  function conditionBadge(item) {
    if (!item.available) return '<span class="condition sold">Продано</span>';
    if (!item.condition) return '';
    const [label, ...details] = item.condition.split(' · ');
    const explanation = details.length ? ' <small>' + escape(details.join(' · ')) + '</small>' : '';
    return '<span class="condition grade">' + escape(label) + explanation + '</span>';
  }
  function tile(item,index) {
    const id=escape(item.uid), article=escape(articleLabel(item)), size=escape(sizeLabel(item));
    return '<article class="card" id="pair-'+id+'"><div class="card-media">'+
      '<button class="product-photo" type="button" data-open="'+id+'" aria-label="Розглянути '+article+', '+escape(item.color)+', '+size+'">'+visual(item,'studio',index>=6)+'</button>'+
      '<div class="media-badges"><span class="size-tag">'+size+'</span>'+conditionBadge(item)+'</div>'+
      '</div><div class="card-info"><h3><button type="button" class="article-link" data-open="'+id+'">'+article+'</button></h3>'+seasonLine(item)+colour(item)+
      '<div class="card-action"><span class="price">'+money(item.price)+'</span>'+buyButton(item)+'</div></div></article>';
  }
  function render() {
    const selection=items.filter(item=>!activeSize || item.size===activeSize);
    selection.sort((a,b)=>{
      const availability=Number(b.available)-Number(a.available);
      if(availability) return availability;
      const byPrice=sort==='low'?a.price-b.price:sort==='high'?b.price-a.price:0;
      return byPrice || (notes[a.uid]?.rank??999)-(notes[b.uid]?.rank??999);
    });
    const count=selection.filter(item=>item.available).length;
    byId('result-count').textContent=count+' у наявності';
    sizes.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.size===activeSize)));
    byId('sort').value=sort;
    grid.innerHTML=selection.length?selection.map(tile).join(''):'<p class="empty">Наразі пар немає.</p>';
    syncBasket();
  }
  function syncHero() {
    const hero=itemFor(heroUid);
    byId('hero-product').hidden=!hero;
    if(hero) {
      byId('hero-name').textContent=articleLabel(hero);
      byId('hero-spec').textContent=sizeLabel(hero)+' · '+(hero.available?money(hero.price):'Продано');
      byId('hero-product').setAttribute('aria-label','Розглянути '+articleLabel(hero)+', '+hero.color+', '+sizeLabel(hero));
    }
    const prices=items.filter(i=>i.available && i.price>0).map(i=>i.price);
    byId('starting-price').hidden=!prices.length;
    if(prices.length) byId('starting-price').textContent='від '+money(Math.min(...prices));
  }
  function fillSizes() {
    const all=[...new Set(items.map(item=>item.size))].sort((a,b)=>Number(a)-Number(b));
    sizes.innerHTML='<button type="button" data-size="" aria-label="Усі розміри">Усі</button>'+all.map(size=>{
      const lengths=new Set(items.filter(item=>item.size===size).map(item=>centimeters(item.cm)));
      const cm=lengths.size===1 ? [...lengths][0] : '';
      const label=escape('Розмір EU '+size+(cm?' · '+cm:''));
      return '<button type="button" data-size="'+escape(size)+'" aria-label="'+label+'">'+escape(size)+(cm?'<small>'+escape(cm)+'</small>':'')+'</button>';
    }).join('');
  }
  function changeFilter(key,value) {
    const url=new URL(location.href);
    if(value && value!=='edit') url.searchParams.set(key,value); else url.searchParams.delete(key);
    history.replaceState(history.state,'',url);
    syncRoute(true);
  }
  function syncRoute(force=false) {
    const query=new URLSearchParams(location.search);
    const size=query.get('size')||'';
    const newSize=items.some(item=>item.size===size)?size:'';
    const newSort=['low','high'].includes(query.get('sort'))?query.get('sort'):'edit';
    const changed=newSize!==activeSize || newSort!==sort;
    activeSize=newSize; sort=newSort;
    if(force || changed) render();
    const item=itemFor(query.get('pair'));
    if(item) {
      if(activeUid!==item.uid || !detail.open || force) showProduct(item,activeUid===item.uid?activeView:'studio',false);
    } else if(detail.open) dismiss();
  }
  function facts(item) {
    const pairs=[[item.cm ? 'Розмір / устілка' : 'Розмір',sizeLabel(item)],['Наявність',item.available?'1 пара':'Продано']];
    return '<dl class="facts">'+pairs.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl>';
  }
  function showProduct(item,view='studio',navigate=true) {
    if(!item) return;
    if(navigate) {
      const url=new URL(location.href);
      if(url.searchParams.get('pair')!==item.uid) {
        url.searchParams.set('pair',item.uid);
        history.pushState({...history.state,bfDetail:true},'',url);
      }
    }
    const wasOpen=detail.open;
    activeUid=item.uid;
    activeView=viewsFor(item).includes(view)?view:'studio';
    const meta=notes[item.uid];
    const desc=meta?.description?'<p class="detail-desc">'+escape(meta.description)+'</p>':'';
    byId('detail-body').innerHTML='<div class="detail-layout"><div class="detail-gallery"><div class="detail-stage" id="stage">'+
      '<div id="stage-picture"></div><button type="button" class="expand" data-zoom>Збільшити фото</button></div>'+
      '<div class="thumb-list" role="group" aria-label="Фотографії пари">'+viewsFor(item).map(v=>'<button type="button" class="thumb" data-select-view="'+v+'">'+
        visual(item,v,false,true)+'<span>'+viewNames[v]+'</span></button>').join('')+'</div></div>'+
      '<div class="detail-copy"><h2 class="details-name" id="detail-title">'+escape(articleLabel(item))+'</h2>'+
      seasonLine(item)+colour(item)+(item.condition?'<p class="detail-flag">'+escape(item.condition)+'</p>':'')+desc+facts(item)+
      '<div class="detail-links"><button class="guide-link" data-guide type="button"><span class="ruler" aria-hidden="true"></span>Уточнити розмір</button>'+
      '<button class="share" type="button" data-share>Посилання на пару</button></div><p id="share-result" role="status" hidden></p>'+
      '<div class="detail-buy"><strong class="price">'+money(item.price)+'</strong>'+buyButton(item)+'</div></div></div>';
    setView(activeView);
    if(!wasOpen) {
      detail.showModal();
      detail.scrollTop=0;
      window.trackJourney?.('product_open',{uid:item.uid,title:item.title,price:item.price});
    }
    syncBasket();
  }
  function setView(view) {
    const item=itemFor(activeUid);
    if(!item || !viewsFor(item).includes(view)) return;
    activeView=view;
    byId('stage-picture').innerHTML=visual(item,view,false,false,true);
    detail.querySelectorAll('[data-select-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.selectView===view)));
  }
  function stepView(direction) {
    const item=itemFor(activeUid);
    if(!item) return;
    const views=viewsFor(item), idx=views.indexOf(activeView);
    setView(views[(idx+direction+views.length)%views.length]);
  }
  function dismiss() {
    if(zoom.open) zoom.close();
    if(guide.open) guide.close();
    detail.close(); activeUid=null; activeView='studio';
  }
  function closeProduct() {
    if(!detail.open) return;
    dismiss();
    if(history.state?.bfDetail) { history.back(); return; }
    const url=new URL(location.href);
    url.searchParams.delete('pair');
    history.replaceState(history.state,'',url);
  }
  function showZoom() {
    const item=itemFor(activeUid);
    if(!item) return;
    const pic=byId('zoom-image'), area=byId('zoom-scroll');
    byId('zoom-title').textContent=articleLabel(item)+' · '+viewNames[activeView];
    pic.alt=articleLabel(item)+' · '+item.color;
    const pos=activeView==='macro'?notes[item.uid].focus:[50,65];
    const position=()=>requestAnimationFrame(()=>{
      area.scrollLeft=pic.clientWidth*pos[0]/100-area.clientWidth/2;
      area.scrollTop=pic.clientHeight*pos[1]/100-area.clientHeight/2;
    });
    pic.onload=position;
    pic.src=activeView==='studio'?item.photo:original(item);
    zoom.showModal();
    if(pic.complete) position();
  }
  async function share() {
    const item=itemFor(activeUid);
    if(!item) return;
    const url=new URL('/black-friday',location.origin);
    url.searchParams.set('pair',item.uid);
    const feedback=byId('share-result');
    feedback.hidden=false;
    try {
      await navigator.clipboard.writeText(url.href);
      feedback.textContent='Посилання скопійовано.';
    } catch {
      const input=document.createElement('input');
      input.readOnly=true; input.value=url.href; input.setAttribute('aria-label','Посилання на цю пару');
      feedback.replaceChildren(input); input.select();
    }
  }
  async function refresh() {
    if(loading) return;
    loading=true;
    try {
      const response=await fetch('/api/black-friday',{cache:'no-store'});
      if(!response.ok) throw new Error('Catalogue unavailable');
      const data=await response.json();
      if(!Array.isArray(data.items)) throw new Error('Catalogue unavailable');
      if(!hasLoaded || JSON.stringify(data.items)!==JSON.stringify(items)) {
        items=data.items; hasLoaded=true;
        fillSizes(); syncHero(); syncRoute(true);
      }
      byId('error').hidden=true;
    } catch {
      items=[]; hasLoaded=false;
      grid.replaceChildren(); sizes.replaceChildren(); syncHero();
      byId('result-count').textContent=''; byId('error').hidden=false;
      if(detail.open) dismiss();
    } finally { loading=false; byId('loading').hidden=true; }
  }
  sizes.addEventListener('click',e=>{const b=e.target.closest('[data-size]');if(b) changeFilter('size',b.dataset.size);});
  byId('sort').addEventListener('change',e=>changeFilter('sort',e.target.value));
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');
    if(!b) return;
    if(b.hasAttribute('data-open')) showProduct(itemFor(b.dataset.open));
    else if(b.hasAttribute('data-buy')) add(itemFor(b.dataset.buy));
    else if(b.hasAttribute('data-select-view')) setView(b.dataset.selectView);
    else if(b.hasAttribute('data-guide')) guide.showModal();
    else if(b.hasAttribute('data-zoom')) showZoom();
    else if(b.hasAttribute('data-share')) share();
  });
  byId('hero-product').addEventListener('click',()=>showProduct(itemFor(heroUid)));
  detail.addEventListener('cancel',e=>{e.preventDefault();closeProduct();});
  detail.querySelector('.close').addEventListener('click',closeProduct);
  detail.addEventListener('click',e=>{if(e.target===detail) closeProduct();});
  detail.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); stepView(e.key==='ArrowLeft'?-1:1);
  });
  detail.addEventListener('pointerdown',e=>{
    gesture=e.pointerType==='touch' && e.target.closest('#stage-picture')?[e.clientX,e.clientY]:null;
  });
  detail.addEventListener('pointerup',e=>{
    if(!gesture) return;
    const dx=e.clientX-gesture[0],dy=e.clientY-gesture[1]; gesture=null;
    if(Math.abs(dx)>45 && Math.abs(dx)>1.5*Math.abs(dy)) stepView(dx<0?1:-1);
  });
  detail.addEventListener('pointercancel',()=>{gesture=null;});
  for(const dialog of [guide,zoom]) {
    dialog.querySelector('.close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',e=>{if(e.target===dialog) dialog.close();});
  }
  byId('notice').querySelector('button').addEventListener('click',()=>{byId('notice').hidden=true;});
  byId('retry').addEventListener('click',refresh);
  window.addEventListener('popstate',()=>{if(hasLoaded) syncRoute();});
  window.addEventListener('pageshow',()=>{syncBasket();refresh();});
  window.addEventListener('storage',e=>{if(e.key===basketKey) syncBasket();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncBasket();refresh();}});
  syncBasket(); refresh();
})();
