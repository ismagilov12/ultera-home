/* ULTERA feed statistics v2. Read-only website funnel, not Meta Ads Insights. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ULTERA_FEED_STATS = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSION = 2;
  const NUMBERS = ['entry_sessions','direct_link_sessions','views','view_sessions','cart_sessions',
    'converted_sessions','matched_orders','matched_revenue','matched_approved_orders','item_orders',
    'item_qty','item_revenue','approved_qty','approved_revenue','pending_qty','rejected_qty','unknown_qty'];
  function ratio(n, d) {
    if (!d) return null;
    if (n < 0 || d < 0 || n > d) throw new Error('Порушено послідовність воронки. CR не показано.');
    return n / d * 100;
  }
  function kyivParts(date) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type,Number(p.value)]));
  }
  function startOfKyivDay(y, m, d) {
    const target = Date.UTC(y, m - 1, d);
    let instant = target;
    for (let i=0;i<3;i++) {
      const p = kyivParts(new Date(instant));
      const offset = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-instant;
      instant = target-offset;
    }
    return new Date(instant).toISOString();
  }
  function periodBounds(days, now) {
    if (![1,7,30,90].includes(days)) throw new Error('Непідтримуваний період');
    now = now || new Date();
    const p = kyivParts(now), day = new Date(Date.UTC(p.year,p.month-1,p.day-(days-1)));
    return {from:startOfKyivDay(day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate()),to:now.toISOString()};
  }
  function normalizeRow(raw) {
    const row = {...raw};
    for (const key of NUMBERS) {
      row[key] = Number(raw[key] || 0);
      if (!Number.isFinite(row[key]) || row[key] < 0) throw new Error('Некоректне значення статистики');
    }
    if (row.converted_sessions > row.cart_sessions || row.cart_sessions > row.entry_sessions)
      throw new Error('Порушено послідовність воронки. CR не показано.');
    row.cr = ratio(row.converted_sessions,row.entry_sessions);
    row.cart_cr = ratio(row.converted_sessions,row.cart_sessions);
    return row;
  }
  function totals(rows) {
    const sum = Object.fromEntries(NUMBERS.map(k => [k,0]));
    for (const row of rows) for (const k of NUMBERS) sum[k] += row[k];
    sum.cr = ratio(sum.converted_sessions,sum.entry_sessions);
    sum.cart_cr = ratio(sum.converted_sessions,sum.cart_sessions);
    return sum;
  }
  function init(options) {
    const doc = document, rest = options.rest;
    const el = id => doc.getElementById(id);
    if (!el('page-feed') || el('page-feed').dataset.statsVersion === String(VERSION)) return;
    el('page-feed').dataset.statsVersion = String(VERSION);
    const fs = {days:7,view:'table',metric:'funnel',sort:'entry_sessions',dir:'desc',q:'',family:'',only:false,
      rows:[],orphans:[],payload:null,loadedKey:'',pendingKey:null,sequence:0};
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const nf = value => Number(value || 0).toLocaleString('uk-UA',{maximumFractionDigits:2});
    const money = value => Math.round(Number(value || 0)).toLocaleString('uk-UA')+' ₴';
    const pct = value => value == null ? '—' : value.toLocaleString('uk-UA',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
    const when = iso => iso ? new Date(iso).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
    const numericPrice = value => Number.parseFloat(String(value || '')) || 0;
    function feedItems(xml) {
      const parsed = new DOMParser().parseFromString(xml,'application/xml');
      if (parsed.getElementsByTagName('parsererror').length) throw new Error('Не вдалося прочитати feed.xml');
      const g = (node,tag) => (node.getElementsByTagNameNS('http://base.google.com/ns/1.0',tag)[0]?.textContent || '').trim();
      return Array.from(parsed.getElementsByTagName('item')).map(n => {
        const link=g(n,'link'), token=new URL(link,location.origin).searchParams.get('p') || '';
        const uid=String(token.includes(',') ? token.split(',').pop() : token || g(n,'id')).toLowerCase();
        const regular=numericPrice(g(n,'price')), sale=numericPrice(g(n,'sale_price'));
        return {uid,sku:g(n,'id'),title:g(n,'title'),family:g(n,'custom_label_1'),color:g(n,'color'),
          link,image:g(n,'image_link'),price:sale && sale < regular ? sale : regular,priceOld:sale && sale < regular ? regular : 0};
      });
    }
    function combine(items,payload) {
      if (payload?.version !== VERSION || !Array.isArray(payload.rows)) throw new Error('Потрібен новий розрахунок воронки v2');
      const unique=new Set(payload.rows.map(r => String(r.uid).toLowerCase()));
      if(unique.size !== payload.rows.length)throw new Error('Повторний SKU у статистиці');
      const summary=payload.summary || {};
      if(Number(summary.tracked_orders || 0)>Number(summary.site_orders || 0))throw new Error('Порушено покриття замовлень');
      const map = new Map(payload.rows.map(r => [String(r.uid).toLowerCase(),r]));
      const ids = new Set();
      fs.rows = items.map(item => {
        if (ids.has(item.uid)) throw new Error('Повторний SKU у фіді');
        ids.add(item.uid);
        return normalizeRow({...item,...map.get(item.uid)});
      });
      fs.orphans = payload.rows.filter(r => !ids.has(String(r.uid).toLowerCase())).map(raw => normalizeRow({
        ...raw,title:raw.catalog_title || raw.uid,family:raw.catalog_family || '',sku:raw.uid,
        link:'',image:'',price:0,priceOld:0
      }));
    }
    function filteredRows(forTotals) {
      const q=fs.q.trim().toLowerCase();
      return fs.rows.filter(r => (!fs.only || fs.metric === 'sales' || r.entry_sessions > 0)
        && (!fs.family || r.family === fs.family)
        && (!q || [r.title,r.uid,r.sku,r.color].join(' ').toLowerCase().includes(q))
        && (forTotals || fs.metric !== 'sales' || r.item_qty > 0)).sort((a,b) => {
        const k=fs.sort,dir=fs.dir === 'asc' ? 1 : -1;
        if (['title','top_source'].includes(k)) return dir*String(a[k] || '').localeCompare(String(b[k] || ''),'uk');
        if (k === 'last_entry') return dir*((Date.parse(a[k]) || 0)-(Date.parse(b[k]) || 0));
        return dir*((Number(a[k]) || 0)-(Number(b[k]) || 0));
      });
    }
    function modelCell(r) {
      return '<td>'+(r.image ? '<img class="fstat-thumb" loading="lazy" alt="" src="'+esc(r.image)+'">' : '')+'</td>'+
        '<td><div class="fstat-name">'+esc(r.title)+(r.color ? '<span class="fstat-chip">'+esc(r.color)+'</span>' : '')+
        '</div><div class="fstat-sub">'+esc(r.sku || r.uid)+'</div></td>'+
        '<td class="num">'+(r.priceOld ? '<s style="opacity:.45">'+nf(r.priceOld)+'</s> ' : '')+money(r.price)+'</td>';
    }
    function actions(r) {
      return '<td>'+(r.link ? '<a class="fstat-act" href="'+esc(r.link)+'" target="_blank" rel="noopener" aria-label="Відкрити '+esc(r.title)+'">↗</a>' : '')+'</td>';
    }
    function header(columns) {
      return '<tr><th></th>'+columns.map(([key,label,tip]) => '<th '+(key ? 'data-sort="'+key+'" tabindex="0" role="button"' : '')+
        (tip ? ' title="'+esc(tip)+'"' : '')+' class="'+(key === 'title' || key === 'top_source' ? '' : 'num')+'">'+label+
        (fs.sort === key ? (fs.dir === 'desc' ? ' ▼' : ' ▲') : '')+'</th>').join('')+'<th></th></tr>';
    }
    function render() {
      const rows=filteredRows(),sum=totals(filteredRows(true)),body=el('fstat-table').querySelector('tbody');
      el('fstat-kpi-entries').textContent=nf(sum.entry_sessions);
      el('fstat-kpi-carts').textContent=nf(sum.cart_sessions);
      el('fstat-kpi-converted').textContent=nf(sum.converted_sessions);
      el('fstat-kpi-cr').textContent=pct(sum.cr);
      el('fstat-kpi-cart-cr').textContent=pct(sum.cart_cr);
      el('fstat-kpi-orders').textContent=nf(sum.matched_orders);
      el('fstat-kpi-approved').textContent=nf(sum.matched_approved_orders);
      el('fstat-only-label').style.display=fs.metric === 'sales' ? 'none' : '';
      const funnel = fs.metric === 'funnel';
      el('fstat-table-description').textContent=funnel
        ? 'Одна модель входу на сесію. Кошик і замовлення — будь-які товари пізніше в цій самій сесії. CR — частка сесій, не кількість замовлень.'
        : 'Оригінальні SKU із збережених замовлень сайту, незалежно від наявності подій. Суми після знижки розподілені пропорційно вартості позицій. Це не оплата чи викуп.';
      const columns=funnel
        ? [['title','Модель входу'],['price','Ціна зараз'],['entry_sessions','Сесії входу'],['views','Перегляди','Усі події product_view / color_view цієї моделі'],
          ['cart_sessions','Із кошиком'],['converted_sessions','Із замовленням'],['cr','CR входу'],['cart_cr','CR кошика'],
          ['matched_orders','Замовлень'],['matched_approved_orders','Апрувів CRM'],['matched_revenue','Сума замовлень'],['top_source','Джерело'],['last_entry','Останній вхід']]
        : [['title','Модель / SKU'],['price','Ціна зараз'],['item_orders','Замовлень','Одне замовлення може містити кілька SKU'],
          ['item_qty','У замовленнях, шт.'],['approved_qty','Апрувнуто, шт.'],['pending_qty','Нові, шт.'],['rejected_qty','Відмови, шт.'],
          ['unknown_qty','Статус невідомий, шт.'],['item_revenue','Сума товарів'],['approved_revenue','Сума апрувів']];
      el('fstat-table').querySelector('thead').innerHTML=header(columns);
      const td=value => '<td class="num">'+value+'</td>';
      body.innerHTML=rows.map(r => '<tr'+(r.converted_sessions ? ' class="has-orders"' : '')+'>'+modelCell(r)+(funnel
        ? td(nf(r.entry_sessions))+td(nf(r.views))+td(nf(r.cart_sessions))+td(nf(r.converted_sessions))+td(pct(r.cr))+td(pct(r.cart_cr))+
          td(nf(r.matched_orders))+td(nf(r.matched_approved_orders))+td(money(r.matched_revenue))+
          '<td>'+esc(r.top_source || '—')+'</td><td style="white-space:nowrap">'+when(r.last_entry)+'</td>'
        : td(nf(r.item_orders))+td(nf(r.item_qty))+td(nf(r.approved_qty))+td(nf(r.pending_qty))+td(nf(r.rejected_qty))+
          td(nf(r.unknown_qty))+td(money(r.item_revenue))+td(money(r.approved_revenue)))+actions(r)+'</tr>').join('') ||
          '<tr><td colspan="16" class="ana-empty">Немає даних за цими фільтрами</td></tr>';
      el('fstat-table').querySelector('tfoot').innerHTML='<tr><td colspan="3">Разом · '+nf(rows.length)+' моделей</td>'+(funnel
        ? td(nf(sum.entry_sessions))+td(nf(sum.views))+td(nf(sum.cart_sessions))+td(nf(sum.converted_sessions))+td(pct(sum.cr))+td(pct(sum.cart_cr))+
          td(nf(sum.matched_orders))+td(nf(sum.matched_approved_orders))+td(money(sum.matched_revenue))+'<td colspan="3"></td>'
        : '<td class="num" title="Замовлення з кількома SKU не підсумовуємо двічі">—</td>'+td(nf(sum.item_qty))+td(nf(sum.approved_qty))+
          td(nf(sum.pending_qty))+td(nf(sum.rejected_qty))+td(nf(sum.unknown_qty))+td(money(sum.item_revenue))+td(money(sum.approved_revenue))+'<td></td>')+'</tr>';
      el('fstat-cards').innerHTML=rows.map(r => '<div class="fstat-card"><div class="ph">'+(r.image ? '<img loading="lazy" alt="" src="'+esc(r.image)+'">' : '')+
        '</div><div class="bd"><div class="t">'+esc(r.title)+'</div><div class="p">'+money(r.price)+'</div><div class="st">'+
        (funnel ? '<div><b>'+nf(r.entry_sessions)+'</b><span>сесії входу</span></div><div><b>'+nf(r.cart_sessions)+
          '</b><span>із кошиком</span></div><div><b>'+pct(r.cr)+'</b><span>CR входу</span></div>'
          : '<div><b>'+nf(r.item_qty)+'</b><span>оформлено, шт.</span></div><div><b>'+nf(r.approved_qty)+
            '</b><span>апрув, шт.</span></div><div><b>'+money(r.item_revenue)+'</b><span>сума товарів</span></div>')+'</div></div></div>').join('');
      el('fstat-table-wrap').style.display=fs.view === 'table' ? '' : 'none';
      el('fstat-cards').style.display=fs.view === 'cards' ? '' : 'none';
      const outside=fs.orphans.filter(r => r.entry_sessions || r.item_qty);
      el('fstat-outside-count').textContent='('+nf(outside.length)+')';
      el('fstat-orphans').querySelector('tbody').innerHTML=outside.map(r => '<tr><td>'+esc(r.title)+'<div class="fstat-sub">'+esc(r.uid)+'</div></td>'+
        td(nf(r.entry_sessions))+td(nf(r.converted_sessions))+td(nf(r.item_qty))+td(nf(r.approved_qty))+'</tr>').join('') ||
        '<tr><td colspan="5" class="ana-empty">Немає моделей поза поточним фідом</td></tr>';
    }
    function context() {
      const p=fs.payload,s=p.summary || {},site=Number(s.site_orders || 0);
      const percent=site ? Number(s.tracked_orders || 0)/site*100 : null;
      el('fstat-meta').textContent=nf(fs.rows.length)+' позицій · '+when(p.from)+' — '+when(p.to)+' · Київ';
      el('fstat-site-summary').textContent='Усі оформлені замовлення сайту за період: '+nf(site)+' · Апруви CRM: '+nf(s.site_approved)+
        ' · Нові: '+nf(s.site_pending)+' · Відмови: '+nf(s.site_rejected)+' · Статус невідомий: '+nf(s.site_unknown)+'. Фільтри моделей нижче не змінюють ці числа.';
      let text='Для всіх моделей сайту, включно з моделями поза фідом: повна послідовність підтверджена для '+nf(s.tracked_orders)+' із '+nf(site)+' замовлень ('+pct(percent)+
        '). Із записаним входом, але без повної корзини до замовлення: '+nf(s.orders_without_cart)+
        '; без записаного входу: '+nf(s.orders_without_entry)+'. Ці замовлення не втрачені — вони є у товарах і загальному підсумку.';
      if (s.stale_crm_orders) text+=' У '+nf(s.stale_crm_orders)+' замовлень статус CRM не оновлювався понад 24 год або час синхронізації відсутній; показано останній збережений стан.';
      if (s.items_missing_uid) text+=' У '+nf(s.items_missing_uid)+' позицій на '+money(s.missing_uid_revenue)+' немає SKU — до моделей їх не приписуємо.';
      if (s.unallocated_item_revenue) text+=' Немає цін позицій для розподілу '+money(s.unallocated_item_revenue)+'.';
      text+=' QA-сесій виключено: '+nf(s.qa_sessions_excluded)+'.';
      el('fstat-coverage').textContent=text;
      el('fstat-status').textContent='Поточний трекер сайту · оновлено '+when(p.generated_at)+' · події та сесії, не люди';
    }
    async function load(force) {
      if (!force && (fs.loadedKey === String(fs.days) || fs.pendingKey === String(fs.days))) return;
      const request=++fs.sequence,bounds=periodBounds(fs.days),days=fs.days;
      fs.pendingKey=String(days);fs.payload=null;fs.rows=[];fs.orphans=[];fs.loadedKey='';
      el('fstat-meta').textContent=when(bounds.from)+' — '+when(bounds.to)+' · Київ';
      el('fstat-status').textContent='Читаю події та збережені замовлення…';
      el('fstat-site-summary').textContent='Завантажую підсумок замовлень…';
      el('fstat-coverage').textContent='';el('fstat-cards').innerHTML='';
      el('fstat-outside-count').textContent='';el('fstat-orphans').querySelector('tbody').innerHTML='';
      for (const id of ['entries','carts','converted','cr','cart-cr','orders','approved']) el('fstat-kpi-'+id).textContent='—';
      el('fstat-table').querySelector('thead').innerHTML='';
      el('fstat-table').querySelector('tbody').innerHTML='<tr><td colspan="16" class="ana-empty">Завантажую…</td></tr>';
      el('fstat-table').querySelector('tfoot').innerHTML='';
      try {
        const [xml,result]=await Promise.all([
          fetch('/feed.xml?_='+Date.now(),{cache:'no-store'}).then(r => {if(!r.ok)throw new Error('feed.xml: '+r.status);return r.text();}),
          rest('rpc/ulhome_feed_link_stats_v2',{method:'POST',body:JSON.stringify({p_from:bounds.from,p_to:bounds.to})})
        ]);
        if (request !== fs.sequence) return;
        const payload=Array.isArray(result) ? result[0] : result;
        combine(feedItems(xml),payload);
        fs.payload=payload;fs.loadedKey=String(days);
        const families=Array.from(new Set(fs.rows.map(r => r.family).filter(Boolean))).sort((a,b) => a.localeCompare(b,'uk'));
        el('fstat-family').innerHTML='<option value="">Усі сімʼї</option>'+families.map(f => '<option value="'+esc(f)+'">'+esc(f)+'</option>').join('');
        el('fstat-family').value=fs.family;
        context();render();
      } catch(error) {
        if (request !== fs.sequence) return;
        fs.rows=[];fs.orphans=[];fs.payload=null;fs.loadedKey='';
        el('fstat-status').textContent='Не вдалося завантажити статистику: '+error.message;
        el('fstat-table').querySelector('tbody').innerHTML='<tr><td colspan="16" class="ana-empty">'+esc(error.message)+'</td></tr>';
        el('fstat-site-summary').textContent='Дані не завантажено.';el('fstat-coverage').textContent='';el('fstat-cards').innerHTML='';
      } finally {
        if(request === fs.sequence)fs.pendingKey=null;
      }
    }
    el('fstat-period').addEventListener('click',event => {
      const button=event.target.closest('button[data-days]');if(!button)return;
      el('fstat-period').querySelectorAll('button').forEach(b => b.classList.toggle('active',b === button));
      fs.days=Number(button.dataset.days);load(true);
    });
    for (const [id,key] of [['fstat-view','view'],['fstat-metric','metric']]) el(id).addEventListener('click',event => {
      const button=event.target.closest('button[data-'+key+']');if(!button)return;
      el(id).querySelectorAll('button').forEach(b => b.classList.toggle('active',b === button));
      fs[key]=button.dataset[key];
      if (key === 'metric') {fs.sort=fs.metric === 'sales' ? 'approved_qty' : 'entry_sessions';fs.dir='desc';}
      if (fs.payload) render();
    });
    function sort(event) {
      if (event.type === 'keydown' && !['Enter',' '].includes(event.key)) return;
      const th=event.target.closest('th[data-sort]');if(!th)return;
      if (event.type === 'keydown') event.preventDefault();
      if(fs.sort === th.dataset.sort)fs.dir=fs.dir === 'desc' ? 'asc' : 'desc';
      else {fs.sort=th.dataset.sort;fs.dir=fs.sort === 'title' || fs.sort === 'top_source' ? 'asc' : 'desc';}
      if(fs.payload)render();
    }
    el('fstat-table').querySelector('thead').addEventListener('click',sort);
    el('fstat-table').querySelector('thead').addEventListener('keydown',sort);
    el('fstat-search').addEventListener('input',event => {fs.q=event.target.value;if(fs.payload)render();});
    el('fstat-family').addEventListener('change',event => {fs.family=event.target.value;if(fs.payload)render();});
    el('fstat-only').addEventListener('change',event => {fs.only=event.target.checked;if(fs.payload)render();});
    el('fstat-reload').addEventListener('click',() => load(true));
    const nav=doc.querySelector('[data-page="feed"]');
    if(nav)nav.addEventListener('click',() => load(false));
    const observer=new MutationObserver(() => {if(el('page-feed').style.display !== 'none')load(false);});
    observer.observe(el('page-feed'),{attributes:true,attributeFilter:['style']});
    if(el('page-feed').style.display !== 'none')load(false);
  }
  return {version:VERSION,ratio,periodBounds,normalizeRow,totals,init};
});
