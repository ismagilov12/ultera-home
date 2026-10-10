(function(){
  'use strict';
  const C=window.UlteraSummary,root=document.getElementById('ultera-summary');if(!root||!C)return;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=n=>new Intl.NumberFormat('uk-UA',{maximumFractionDigits:0}).format(n);
  const uah=n=>n===null||n===undefined?'—':nf(n)+' ₴';
  const pct=n=>n===null||n===undefined?'—':new Intl.NumberFormat('uk-UA',{style:'percent',maximumFractionDigits:1}).format(n);
  const names={standard:'Звичайна',thermal:'Низька термо',boot:'Високий термо',insole:'Устілки',other:'Інше / сейл',unknown:'Версію не вказано'};
  let data=null,result=null,prior=null,config={...C.DEFAULTS},activeTab='models',trendDate=null,loaded=false,requestVersion=0,sourceFilter='all',loading=false;
  const today=C.day(new Date()),yesterday=new Date(today+'T12:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const y=yesterday.toISOString().slice(0,10), start=new Date(y+'T12:00Z');start.setUTCDate(start.getUTCDate()-6);
  let range={from:start.toISOString().slice(0,10),to:y};
  try{config=C.settings(JSON.parse(localStorage.getItem('ultera_summary_assumptions_v1')||'null'));}catch{}
  function delta(value,old,invert){if(value===null||old===null||!old)return '';const v=(value-old)/Math.abs(old);return '<div class="s-delta '+((v>=0)!==!!invert?'s-positive':'s-negative')+'">'+(v>=0?'↑ ':'↓ ')+pct(Math.abs(v))+' до попереднього періоду</div>';}
  function tile(label,value,sub,d,featured){return '<article class="s-kpi '+(featured?'featured':'')+'"><div class="label">'+label+'</div><div class="value">'+value+'</div><div class="sub">'+sub+'</div>'+d+'</article>';}
  root.innerHTML='<div class="s-head"><div><div class="s-eyebrow">ULTERA / Бізнес-аналітика</div><h1>Зведення</h1></div><span class="s-badge" id="s-fresh"><i class="s-dot"></i> Дані захищені входом</span></div><div class="s-toolbar"><button data-preset="today">Сьогодні</button><button data-preset="7" class="active">7 завершених днів</button><button data-preset="month">Цей місяць</button><button data-preset="30">30 завершених днів</button><label>Від <input id="s-from" type="date" aria-label="Початок періоду" value="'+range.from+'"></label><label>До <input id="s-to" type="date" aria-label="Кінець періоду" value="'+range.to+'"></label><button id="s-apply">Показати</button><span class="s-spacer"></span><button id="s-refresh" class="primary">Оновити дані</button></div><div id="s-error" role="alert"></div><div id="s-content"><div class="s-loading">Завантажую продажі та витрати…</div></div><details class="s-panel s-settings" hidden><summary>Параметри розрахунку <span class="s-muted">Курс, собівартість, загальні витрати</span></summary><form id="s-config"><div class="s-settings-grid">'+[['fx','Курс грн / $'],['standard','Звичайна пара, грн'],['thermal','Низька термо, грн'],['boot','Високий термо, грн'],['insole','Устілки, грн (якщо відомо)'],['overhead','Загальні витрати за місяць, грн'],['extra','Додаткові витрати за період, грн']].map(([k,label])=>'<label>'+label+'<input name="'+k+'" type="number" min="'+(k==='fx'?'.01':'0')+'" step=".01" value="'+(config[k]??'')+'" '+(k==='insole'?'':'required')+'></label>').join('')+'</div><p class="s-muted">Собівартість і загальні витрати нижче — ваші планові вводні, не перевірені фактичні витрати. Якщо в позиції є собівартість CRM, пріоритет має вона. Не дублюйте зарплату виробництва у нормі та загальних витратах. Зміни тут не змінюють ціни чи замовлення.</p><button type="submit" style="margin-top:14px">Перерахувати</button></form></details>';
  const el=id=>document.getElementById(id);
  root.querySelector('.s-toolbar').insertAdjacentHTML('afterend','<div class="s-toolbar"><label>Джерело <select id="s-source" aria-label="Джерело замовлень"><option value="all">Усі джерела KeyCRM</option></select></label><span class="s-muted" id="s-source-note">Усі замовлення читаються безпосередньо з CRM, без дублювання сайтом.</span></div>');
  function notices(r){
    const b=r.buckets,parts=[];
    if(!r.advertising.complete)parts.push('Реклама покриває '+r.advertising.coveredDays+' із '+r.days+' днів. Прибуток і ціна апрува приховані до повного покриття.');
    if(b.approved.missingCostUnits)parts.push('Немає собівартості для '+nf(b.approved.missingCostUnits)+' од. в апрувах. Додайте її в параметрах, якщо відома; нуль не підставляється.');
    if(b.unknown.orders)parts.push(nf(b.unknown.orders)+' заявок без підтвердженого статусу CRM — не включені в апруви.');
    if(b.waiting.orders)parts.push(nf(b.waiting.orders)+' апрувів ще очікують викупу. Результат від викупів у цій молодій когорті не є остаточним прибутком або збитком бізнесу.');
    if(r.metadata.adSourceReady===false)parts.push('Захищене джерело реклами ще не підключене або тимчасово недоступне.');
    if(r.metadata.ordersComplete===false)parts.push('Замовлення не покривають увесь вибраний період. Фінансові підсумки приховані; доступні дати: '+(r.metadata.earliestOrderDate||'—')+' — '+(r.metadata.latestOrderDate||'—')+'.');
    if(r.metadata.sourceFiltered)parts.push('Окреме джерело: витрати Meta та загальні витрати показані для всього бізнесу. Прибуток, ціна клієнта й ROAS джерела приховані — розподілу реклами між джерелами немає.');
    if(r.metadata.currencyComplete===false)parts.push('Є джерела з невідомою або іншою валютою. Фінансові результати потребують звірки.');
    if(r.quality.unknownCategoryUnits)parts.push('Для '+nf(r.quality.unknownCategoryUnits)+' од. без відмов у цьому періоді немає категорії CRM; вони не зараховані до пар ОБУВЬ.');
    if(r.quality.unknownSizePairs)parts.push('Для '+nf(r.quality.unknownSizePairs)+' пар в апрувах не вказано розмір.');
    if(r.quality.unknownVersionPairs)parts.push('Для '+nf(r.quality.unknownVersionPairs)+' пар в апрувах CRM не вказує однозначно сезон / термо-версію. Частку термо приховано, це не 0%.');
    if(r.reconciliation.crmExpensesApproved)parts.push('Окремо в CRM записано витрат на '+uah(r.reconciliation.crmExpensesApproved)+'. Вони не віднімаються повторно: перевірте, чи включені у ваші загальні / додаткові витрати.');
    if(!r.metadata.preview&&r.metadata.advertisingMode==='stored_days'){const days=(data.adDays||[]).map(d=>d.date).sort();const fetched=(data.adDays||[]).map(d=>d.fetched_at).filter(Boolean).sort().at(-1);parts.push('Meta: збережені імпортовані дні'+(days.length?' до '+days.at(-1):' відсутні')+'. Автоматичне оновлення реклами ще не підключене.'+(fetched?' Дані отримано '+new Date(fetched).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'})+'.':''));}
    if(r.metadata.preview)parts.push('Це локальний знімок на '+new Date(r.metadata.fetchedAt).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'})+'. Оновлення кнопкою перечитує знімок, а не CRM. Ручні замовлення менеджера поза сайтом сюди не входять.');
    if(r.to===today)parts.push('Сьогодні ще не завершено. Для порівняння темпу оберіть завершені дні.');
    return parts.length?'<div class="s-notice">'+parts.map(esc).join('<br>')+'</div>':'';
  }
  function render(){
    if(!data)return;
    const filtered=sourceFilter!=='all',source=data.sources?.find(s=>String(s.id)===sourceFilter);
    const orders=filtered?data.orders.filter(o=>String(o.source_id)===sourceFilter):data.orders;
    const metadata={...data.metadata,sourceFiltered:filtered,scopeLabel:filtered?(source?.site?'Сайт / ':'')+(source?.name||sourceFilter)+' · KeyCRM':data.metadata?.scopeLabel};
    result=C.summarize(orders,data.adDays,range.from,range.to,config,metadata);
    const pr=C.previous(range.from,range.to);
    prior=range.to>=today||(metadata.earliestOrderDate&&pr.from<metadata.earliestOrderDate)?null:C.summarize(orders,data.adDays,pr.from,pr.to,{...config,extra:0},metadata);
    const r=result,b=r.buckets,p=prior?.buckets;
    el('s-fresh').innerHTML='<i class="s-dot"></i>'+esc(data.metadata?.preview?'Локальний знімок':'KeyCRM наживо · '+new Date(data.metadata.fetchedAt).toLocaleTimeString('uk-UA',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit'}));
    const costNote=b.approved.estimatedCostUnits?'Норма застосована до '+nf(b.approved.estimatedCostUnits)+' од.':'Із позицій CRM; може відрізнятися від вашої поточної норми';
    el('s-content').innerHTML='<div class="s-panel-head"><h2>Продажі та прибуток</h2><p class="s-muted">'+esc((metadata.scopeLabel||'Замовлення сайту · статуси KeyCRM')+' · '+r.from+' — '+r.to)+'</p></div>'+reconciliationPanel(r)+'<div class="s-kpis">'+
      tile('Апрувнуто',nf(b.approved.orders),nf(b.approved.pairs)+' пар · '+uah(b.approved.revenue),delta(b.approved.orders,p?.approved.orders??null),true)+
      tile('Викуплено',nf(b.redeemed.orders),uah(b.redeemed.revenue)+' · '+pct(r.redemptionRate)+' від апрувів','')+
      tile('Очікують викупу',nf(b.waiting.orders),uah(b.waiting.revenue),'')+
      tile('Нові / відмови',nf(b.pending.orders)+' / '+nf(b.rejected.orders),nf(b.all.orders)+' комерційних заявок','')+
      tile('Середній чек апрува',uah(r.aov),'Сума після знижок / замовлення',delta(r.aov,prior?.aov??null))+
      tile('Ціна апрува',uah(r.cpo),r.cpo===null?(filtered?'Немає розподілу реклами за джерелами':'Потрібні повні дані реклами'):'$'+(r.cpo/config.fx).toFixed(2)+' · сукупна реклама / апруви',delta(r.cpo,prior?.cpo??null,true))+
      tile('Апрув по клієнтах',pct(r.customerApprovalRate),nf(b.approved.customers)+' із '+nf(b.all.customers)+' · по заявках '+pct(r.approvalRate),'')+
      tile('Частка термо',pct(r.thermalShare),r.quality.unknownVersionPairs?'Немає версії для '+nf(r.quality.unknownVersionPairs)+' із '+nf(b.approved.pairs)+' пар':'Низька термо + високі ботинки','')+'</div>'+
      '<section class="s-panel"><div class="s-finance">'+[
        ['Реклама Meta',r.advertising.complete?uah(r.advertising.uah):'—','$'+r.advertising.usd.toFixed(2)+' завантажено · курс '+config.fx],
        ['Собівартість апрувів',b.approved.missingCostUnits?'—':uah(b.approved.cost),costNote],
        ['Загальні + інші витрати',uah(r.overhead+r.extra),uah(config.overhead)+'/міс. × частка днів + '+uah(r.extra)],
        ['Очікуваний чистий · оцінка',uah(r.profit.expected),'Якщо всі апруви викуплять'],
        ['Від викупів · оцінка',uah(r.profit.redeemed),'Собівартість викупів: '+(b.redeemed.missingCostUnits?'неповна':uah(b.redeemed.cost))]
      ].map(([l,v,s])=>'<div><div class="s-muted">'+l+'</div><div class="amount">'+v+'</div><p class="s-muted">'+s+'</p></div>').join('')+'</div>'+notices(r)+
      '<div class="s-efficiency">'+[['Маржа до реклами',uah(r.grossMargin)],['Маржинальність',pct(r.grossMarginRate)],['Реклама / клієнт з апрувом',uah(r.cac)],['Сума апрувів / реклама',r.roas===null?'—':r.roas.toFixed(2)+'×']].map(([l,v])=>'<div><span class="s-muted">'+l+'</span><b>'+v+'</b></div>').join('')+'</div><p class="s-fineprint">Когорта за датою оформлення на джерелі (KeyCRM ordered_at), часовий пояс — Київ. Апрув: не «Новий», не відмова; «12 / 15 / 20+ днів» включені. Викуп: CRM «Виконано» (12). «Немає в наявності» — загальна причина відмови, не висновок про склад. Прибуток = сума − собівартість − реклама − загальні − додаткові витрати. Не є рухом грошей; податки, комісії та повернення не враховані, якщо їх не внесено у витрати. Реклама / клієнт — змішаний показник, а не вартість залучення нового покупця. Клієнт визначається за повним телефоном, за його відсутності — ID покупця CRM, без показу особистих даних. Назви моделей і розміри — з CRM.</p></section>'+
      '<section class="s-panel"><div class="s-panel-head"><div><h2>Динаміка продажів</h2><p class="s-muted">Апруви та викуп за датою створення</p></div><div class="s-legend"><span><i class="s-key" style="background:#97ba3c"></i>Апруви</span><span><i class="s-key" style="background:#536aec"></i>Викуп</span></div></div>'+chart(r.daily)+'</section>'+
      '<section class="s-panel" id="s-trends" aria-labelledby="s-trends-title"></section>'+
      '<section class="s-panel"><div class="s-tabs" role="tablist" aria-label="Деталі продажів">'+[['models','Топ моделей і розміри'],['sizes','Розміри та версії'],['channels','UTM та міста']].map(([k,label])=>'<button role="tab" id="s-tab-'+k+'" aria-controls="s-pane" aria-selected="'+(activeTab===k)+'" data-tab="'+k+'">'+label+'</button>').join('')+'</div><div id="s-pane" role="tabpanel" aria-labelledby="s-tab-'+activeTab+'"></div></section><p class="s-muted" style="margin:5px 0 22px">Оновлено: '+esc(data.metadata?.fetchedAt?new Date(data.metadata.fetchedAt).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'}):'—')+' · '+esc(data.metadata?.sourceLabel||'Сайт → синхронізація KeyCRM; реклама Windsor.ai')+'. '+(prior?'Порівняння: '+pr.from+' — '+pr.to+'.':'Порівняння приховане: неповний поточний день або немає попереднього періоду.')+'</p>';
    renderTrends();renderTab();
  }
  function reconciliationPanel(r){
    if(!r.metadata.allCRMOrders)return '';
    const v=r.reconciliation;
    return '<section class="s-panel" aria-label="Звірка з KeyCRM"><div class="s-panel-head"><div><h2>Звірка з KeyCRM · ОБУВЬ</h2><p class="s-muted">Категорія 22 · нескасовані замовлення · нові показані окремо</p></div><strong style="font-size:28px">'+nf(v.pairs)+' пар</strong></div><div class="s-efficiency"><div><span class="s-muted">Пари в апрувах</span><b>'+nf(v.approvedPairs)+'</b></div><div><span class="s-muted">Пари в нових / статус невідомий</span><b>'+nf(v.pendingPairs)+' / '+nf(v.unknownPairs)+'</b></div><div><span class="s-muted">Сума товарів CRM</span><b>'+(v.missingProductRevenue?'—':preciseUAH(v.productRevenue))+'</b></div><div><span class="s-muted">Закупівля товарів CRM</span><b>'+(v.missingProductCost?'—':preciseUAH(v.productCost))+'</b></div></div><details style="margin-top:18px"><summary>Розподіл за джерелами</summary><div class="s-table-wrap"><table><thead><tr><th>Джерело</th><th class="num">Пари без відмов</th><th class="num">Пари в апрувах</th><th class="num">Апрув-замовлення</th><th class="num">Клієнти з апрувом</th><th class="num">Сума апрувів</th></tr></thead><tbody>'+r.sources.map(s=>'<tr><td>'+esc(s.name)+'</td><td class="num">'+nf(s.pairs)+'</td><td class="num">'+nf(s.approvedPairs)+'</td><td class="num">'+nf(s.approved)+'</td><td class="num">'+nf(s.approvedCustomers)+'</td><td class="num">'+uah(s.revenue)+'</td></tr>').join('')+'</tbody></table></div></details><p class="s-fineprint">Пари ≠ замовлення ≠ клієнти. Тут суми товарів категорії ОБУВЬ за ціною продажу CRM; нижче — повні суми замовлень з допродажами та іншими складовими. Нульова закупівля у звірці — значення CRM, не підтверджена нульова собівартість у прибутку.</p></section>';
  }
  const trendSpecs=[
    {key:'cac',title:'Ціна апрувнутого клієнта',color:'#7b9625',formula:'Витрати Meta / унікальні клієнти з апрувом за день'},
    {key:'aov',title:'Середній чек апрува',color:'#536aec',formula:'Сума апрувів після знижок / кількість замовлень за день'},
    {key:'adSpend',title:'Рекламний бюджет · витрачено',color:'#b47329',formula:'Фактичні витрати Meta за день, не встановлений ліміт'}
  ];
  const shortDate=d=>d.slice(8)+'.'+d.slice(5,7);
  const preciseUAH=n=>new Intl.NumberFormat('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+' ₴';
  function trendReason(row,key){
    if(key==='cac'&&result.metadata.sourceFiltered)return 'Немає розподілу реклами за джерелами';
    if(key!=='adSpend'&&result.metadata.ordersComplete===false)return 'Неповні дані замовлень';
    if(key!=='aov'&&row.adSpend===null)return 'Немає даних реклами за цей день';
    return 'Немає апрувів за цей день';
  }
  function trendSvg(rows,spec){
    const host=el('s-trend-cards'),columns=getComputedStyle(host).gridTemplateColumns.split(' ').length;
    const w=Math.max(230,Math.round((host.clientWidth-(columns-1)*16)/columns)-32),h=230,left=56,right=18,top=20,bottom=38,plotW=w-left-right,plotH=h-top-bottom;
    const available=rows.filter(r=>Number.isFinite(r[spec.key]));
    const rawMax=Math.max(4,...available.map(r=>r[spec.key])),magnitude=10**Math.floor(Math.log10(rawMax/4));
    const ratio=rawMax/4/magnitude,step=magnitude*(ratio<=1?1:ratio<=2?2:ratio<=5?5:10),max=step*4;
    const x=i=>left+(rows.length===1?.5:i/(rows.length-1))*plotW,y=v=>top+plotH-v/max*plotH;
    let svg='<svg class="s-trend-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(spec.title)+' — щодня, гривні"><title>'+esc(spec.title)+'. Оберіть день для точного значення; усі значення доступні в таблиці нижче.</title>';
    for(let i=0;i<=4;i++){const value=step*i;svg+='<line x1="'+left+'" x2="'+(w-right)+'" y1="'+y(value)+'" y2="'+y(value)+'" class="s-trend-gridline"/><text x="'+(left-9)+'" y="'+(y(value)+5)+'" text-anchor="end">'+esc(nf(value))+'</text>';}
    const selected=rows.findIndex(r=>r.date===trendDate);
    if(selected>=0)svg+='<line x1="'+x(selected)+'" x2="'+x(selected)+'" y1="'+top+'" y2="'+(h-bottom)+'" class="s-trend-guide"/>';
    const segments=[];let segment=[];
    for(let i=0;i<rows.length;i++){const value=rows[i][spec.key];if(Number.isFinite(value))segment.push(x(i)+','+y(value));else if(segment.length){segments.push(segment);segment=[];}}
    if(segment.length)segments.push(segment);
    for(const points of segments)if(points.length>1)svg+='<polyline class="s-trend-line" fill="none" stroke="'+spec.color+'" points="'+points.join(' ')+'"/>';
    rows.forEach((row,i)=>{const value=row[spec.key];if(!Number.isFinite(value))return;const chosen=row.date===trendDate;svg+='<circle cx="'+x(i)+'" cy="'+y(value)+'" r="'+(chosen?6:rows.length>60?2:3.5)+'" fill="'+spec.color+'" '+(chosen?'stroke="#fff" stroke-width="2" ':'')+'data-date="'+row.date+'" data-trend-value="'+value+'"><title>'+esc(row.date+': '+preciseUAH(value))+'</title></circle>';});
    const tickCount=Math.min(w<340?3:5,rows.length);
    const ticks=[...new Set(Array.from({length:tickCount},(_,i)=>Math.round(i*(rows.length-1)/Math.max(1,tickCount-1))))];
    for(const i of ticks)svg+='<text x="'+x(i)+'" y="'+(h-10)+'" text-anchor="middle">'+shortDate(rows[i].date)+'</text>';
    if(!available.length)svg+='<text x="'+(left+plotW/2)+'" y="'+(top+plotH/2)+'" text-anchor="middle" class="s-trend-empty">Немає значень для графіка</text>';
    return svg+'</svg>';
  }
  function renderTrendCards(){
    const row=result.daily.find(d=>d.date===trendDate);
    el('s-trend-cards').innerHTML=trendSpecs.map(spec=>{
      const value=row[spec.key],known=Number.isFinite(value);
      const context=spec.key==='cac'?'Клієнтів з апрувом: '+nf(row.approvedCustomers):spec.key==='aov'?'Апрувнутих замовлень: '+nf(row.approved):'$'+Number(row.adSpendUSD||0).toFixed(2)+' · курс '+config.fx;
      return '<article class="s-trend-card" data-metric="'+spec.key+'"><h3><i class="s-key" style="background:'+spec.color+'"></i>'+spec.title+'</h3><div class="s-trend-reading"><strong>'+uah(value)+'</strong><span>'+shortDate(row.date)+(row.date===today?' · день триває':'')+'</span></div><p class="s-trend-context">'+esc(known?context:trendReason(row,spec.key))+'</p>'+trendSvg(result.daily,spec)+'<p class="s-muted">'+spec.formula+'</p></article>';
    }).join('');
  }
  function renderTrends(){
    const rows=result.daily;
    if(!rows.some(d=>d.date===trendDate))trendDate=[...rows].reverse().find(d=>d.date<today&&Number.isFinite(d.cac))?.date||rows.at(-1).date;
    el('s-trends').innerHTML='<div class="s-panel-head"><div><h2 id="s-trends-title">Ціна клієнта, чек і реклама</h2><p class="s-muted">Щоденна динаміка · гривні · дати за Києвом</p></div><label for="s-trend-day">Показати день <select id="s-trend-day" aria-label="День на графіках">'+rows.map(d=>'<option value="'+d.date+'" '+(d.date===trendDate?'selected':'')+'>'+d.date+(d.date===today?' · день триває':'')+'</option>').join('')+'</select></label></div><div class="s-trend-cards" id="s-trend-cards" aria-live="polite"></div><p class="s-fineprint">Окрема шкала для кожного графіка. Пропуск — немає даних або апрувів; це не нуль. Клієнт рахується один раз у межах дня, але може повторитися в інші дні. Ціна клієнта — змішаний показник за датою створення заявки, не атрибуція нового покупця.</p><details class="s-daily-details"><summary>Таблиця за днями</summary><div class="s-table-wrap"><table><thead><tr><th>День</th><th class="num">Апруви</th><th class="num">Клієнти з апрувом</th><th class="num">Викуп</th><th class="num">Сума апрувів</th><th class="num">Ціна клієнта</th><th class="num">Середній чек</th><th class="num">Реклама, ₴</th><th class="num">Реклама, $</th></tr></thead><tbody>'+rows.map(d=>'<tr><td>'+d.date+(d.date===today?' *':'')+'</td><td class="num">'+d.approved+'</td><td class="num">'+d.approvedCustomers+'</td><td class="num">'+d.redeemed+'</td><td class="num">'+uah(d.revenue)+'</td><td class="num">'+uah(d.cac)+'</td><td class="num">'+uah(d.aov)+'</td><td class="num">'+uah(d.adSpend)+'</td><td class="num">'+(d.adSpendUSD===null?'—':d.adSpendUSD.toFixed(2))+'</td></tr>').join('')+'</tbody></table></div></details>';
    renderTrendCards();el('s-trend-day').onchange=e=>{trendDate=e.target.value;renderTrendCards();};
  }
  function chart(rows){const w=1000,h=210,pad=30,max=Math.max(1,...rows.map(x=>x.approved));const x=i=>pad+(rows.length===1?(.5):(i/(rows.length-1)))*(w-2*pad),yy=v=>h-pad-v/max*(h-2*pad);let s='<svg class="s-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Графік щоденної кількості апрувів та викупів">';for(let i=0;i<=4;i++){const v=max*i/4;s+='<line x1="30" x2="970" y1="'+yy(v)+'" y2="'+yy(v)+'" stroke="#e6ece0"/><text x="22" y="'+(yy(v)+4)+'" text-anchor="end" font-size="11" fill="#74806a">'+Math.round(v)+'</text>';}
    for(const [key,color] of [['approved','#97ba3c'],['redeemed','#536aec']]){s+='<polyline fill="none" stroke="'+color+'" stroke-width="3" points="'+rows.map((r,i)=>x(i)+','+yy(r[key])).join(' ')+'"/>';s+=rows.map((r,i)=>'<circle cx="'+x(i)+'" cy="'+yy(r[key])+'" r="4" fill="'+color+'"><title>'+r.date+': '+(key==='approved'?'апруви':'викуп')+' '+r[key]+'</title></circle>').join('');}
    rows.forEach((r,i)=>{if(i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/8))===0)s+='<text x="'+x(i)+'" y="205" text-anchor="middle" font-size="11" fill="#74806a">'+r.date.slice(8)+'.'+r.date.slice(5,7)+'</text>';});return s+'</svg>';}
  function renderTab(){
    const r=result,pane=el('s-pane');pane.setAttribute('aria-labelledby','s-tab-'+activeTab);
    if(activeTab==='models'){
      pane.innerHTML='<div class="s-panel-head"><div><h2>Що продається найкраще</h2><p class="s-muted">Лише апруви. Натисніть модель — розміри, версії, викуп.</p></div><div class="s-controls"><input id="s-search" type="search" placeholder="Знайти модель…" aria-label="Знайти модель"><select id="s-sort" aria-label="Сортування моделей"><option value="qty">За кількістю</option><option value="revenue">За сумою</option><option value="margin">За маржею до реклами</option></select><button id="s-export">Завантажити CSV</button></div></div><div id="s-model-list"></div>';
      renderProducts();el('s-search').addEventListener('input',renderProducts);el('s-sort').addEventListener('change',renderProducts);el('s-export').addEventListener('click',exportCSV);
    }else if(activeTab==='sizes'){
      const max=Math.max(1,...r.sizes.map(s=>s.qty));
      pane.innerHTML='<div class="s-two"><div><h2>Попит за розмірами</h2><p class="s-muted">Пари взуття в апрувах, без устілок</p>'+r.sizes.map(s=>'<div class="s-bar-row"><b>EU '+esc(s.size)+'</b><div class="s-track"><div class="s-bar" style="width:'+s.qty/max*100+'%"></div></div><b style="text-align:right">'+s.qty+'</b></div>').join('')+'</div><div><h2>Структура продажів</h2><div class="s-table-wrap"><table><thead><tr><th>Версія</th><th class="num">Од.</th><th class="num">Сума</th><th class="num">Маржа*</th></tr></thead><tbody>'+r.variants.map(v=>'<tr><td>'+names[v.kind]+'</td><td class="num">'+v.qty+'</td><td class="num">'+uah(v.revenue)+'</td><td class="num">'+uah(v.missing?null:v.revenue-v.cost)+'</td></tr>').join('')+'</tbody></table></div><p class="s-muted">* До реклами й загальних витрат; із застосованою нормою собівартості там, де немає факту CRM.</p></div></div>';
    }else{
      pane.innerHTML='<h2>UTM → заявки → апруви</h2><p class="s-muted">Це збережена мітка заявки, не повна атрибуція Meta. Повторні заявки одного клієнта не дорівнюють новим клієнтам.</p><div class="s-table-wrap"><table><thead><tr><th>Кампанія UTM</th><th class="num">Заявки</th><th class="num">Клієнти</th><th class="num">Апруви</th><th class="num">Апрув клієнтів</th><th class="num">Викуп</th><th class="num">Сума апрувів</th></tr></thead><tbody>'+r.campaigns.map(c=>'<tr><td>'+esc(c.name)+'</td><td class="num">'+c.submitted+'</td><td class="num">'+c.customers+'</td><td class="num">'+c.approved+'</td><td class="num">'+pct(c.customers?c.approvedCustomers/c.customers:null)+'</td><td class="num">'+c.redeemed+'</td><td class="num">'+uah(c.revenue)+'</td></tr>').join('')+'</tbody></table></div><h2 style="margin-top:24px">Топ міст за апрувами</h2><div class="s-table-wrap"><table><thead><tr><th>Місто</th><th class="num">Апруви</th><th class="num">Сума</th></tr></thead><tbody>'+r.cities.slice(0,15).map(c=>'<tr><td>'+esc(c.name)+'</td><td class="num">'+c.orders+'</td><td class="num">'+uah(c.revenue)+'</td></tr>').join('')+'</tbody></table></div>';
    }
  }
  function selectedProducts(){const q=(el('s-search')?.value||'').toLowerCase().trim(),sort=el('s-sort')?.value||'qty';return result.products.filter(p=>(p.title+' '+p.family).toLowerCase().includes(q)).sort((a,b)=>(b[sort]??-Infinity)-(a[sort]??-Infinity));}
  function renderProducts(){const rows=selectedProducts();el('s-model-list').innerHTML=rows.length?rows.map((p,index)=>'<details class="s-product"><summary><span class="s-rank">'+String(index+1).padStart(2,'0')+'</span><span><span class="s-product-name">'+esc(p.title)+'</span><br>'+p.variants.map(v=>'<span class="s-pill">'+names[v.kind]+' '+v.qty+'</span>').join('')+'</span><span class="s-product-num">'+p.qty+'<small>апрув, од.</small></span><span class="s-product-num s-product-redeemed">'+p.redeemedQty+'<small>викуп, од.</small></span><span class="s-product-num s-product-revenue">'+uah(p.revenue)+'<small>сума апрувів</small></span><span class="s-product-num s-product-margin">'+uah(p.margin)+'<small>маржа до реклами</small></span><span class="s-chevron">›</span></summary><div class="s-product-detail"><div class="s-table-wrap"><table><thead><tr><th>Розмір</th><th>Версія</th><th class="num">Апрув, од.</th><th class="num">Викуп, од.</th><th class="num">Сума апрувів</th></tr></thead><tbody>'+p.sizes.map(s=>'<tr><td><b>'+esc(s.size)+'</b></td><td>'+names[s.kind]+'</td><td class="num">'+s.qty+'</td><td class="num">'+s.redeemed+'</td><td class="num">'+uah(s.revenue)+'</td></tr>').join('')+'</tbody></table></div><p class="s-muted" style="margin-top:8px">Собівартість: '+(p.missingCostUnits?'неповна':uah(p.cost))+'. '+(p.estimatedCostUnits?'Для '+p.estimatedCostUnits+' од. використано розрахункову норму.':'')+'</p></div></details>').join(''):'<div class="s-empty">Немає моделей за цим запитом.</div>';}
  function exportCSV(){const rows=[['Модель','Розмір','Версія','Апрув, од.','Викуп, од.','Сума апрувів, грн']];for(const p of selectedProducts())for(const s of p.sizes)rows.push([p.title,s.size,names[s.kind],s.qty,s.redeemed,C.money(s.revenue)]);const cell=v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='ULTERA-models-sizes-'+range.from+'-'+range.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function load(force){
    if(loading)return;
    loading=true;
    const version=++requestVersion;
    const refresh=el('s-refresh');refresh.disabled=true;el('s-error').innerHTML='';
    for(const control of root.querySelectorAll('.s-toolbar button,.s-toolbar input,.s-toolbar select'))control.disabled=true;
    el('s-content').innerHTML='<div class="s-loading">Читаю всі джерела KeyCRM і звіряю товари… Зазвичай до хвилини; великий період — довше.</div>';
    try{
      const previous=C.previous(range.from,range.to);
      if(window.ULTERA_SUMMARY_PREVIEW){data=window.ULTERA_SUMMARY_PREVIEW;el('s-refresh').textContent='Перечитати знімок';}
      else {await ensureFreshSession();const response=await fetch('/api/summary?from='+previous.from+'&to='+range.to+(force?'&refresh=1':''),{headers:authHeaders(),cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error||'Не вдалося завантажити зведення');data=body;}
      if(version!==requestVersion)return;
      const sources=data.sources||[];
      if(sourceFilter!=='all'&&!sources.some(s=>String(s.id)===sourceFilter))sourceFilter='all';
      el('s-source').innerHTML='<option value="all">Усі джерела KeyCRM</option>'+sources.map(s=>'<option value="'+s.id+'">'+esc((s.site?'Сайт / ':'')+s.name)+'</option>').join('');
      el('s-source').value=sourceFilter;
      el('s-source-note').textContent=data.metadata?.preview?'Локальний знімок лише сайту; повна CRM доступна в опублікованій адмінці.':'Усі замовлення читаються безпосередньо з CRM, без дублювання сайтом.';
      let saved={};try{saved=JSON.parse(localStorage.getItem('ultera_summary_assumptions_v1')||'{}')||{};}catch{}
      config=C.settings({...data.assumptions,...saved});
      for(const [key,value] of Object.entries(config)){const input=el('s-config').elements.namedItem(key);if(input)input.value=value??'';}
      root.querySelector('.s-settings').hidden=false;
      loaded=true;render();
    }catch(e){if(version!==requestVersion)return;root.querySelector('.s-settings').hidden=true;el('s-error').innerHTML='<div class="s-notice s-error">'+esc(e.message)+'</div>';data=null;result=null;prior=null;loaded=false;el('s-content').innerHTML='<div class="s-empty">Не вдалося завантажити вибраний період. Перевірте дати та доступ адміністратора. Дані не замінюються нулями.</div>';}
    finally{loading=false;if(version===requestVersion)for(const control of root.querySelectorAll('.s-toolbar button,.s-toolbar input,.s-toolbar select'))control.disabled=false;}
  }
  root.addEventListener('click',async e=>{
    const tab=e.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;root.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-selected',t===tab));renderTab();return;}
    const preset=e.target.closest('[data-preset]');if(preset){const v=preset.dataset.preset;let to=v==='today'||v==='month'?today:y,from;if(v==='today')from=today;else if(v==='month')from=today.slice(0,7)+'-01';else{const d=new Date(to+'T12:00Z');d.setUTCDate(d.getUTCDate()-Number(v)+1);from=d.toISOString().slice(0,10);}range={from,to};el('s-from').value=from;el('s-to').value=to;root.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b===preset));await load(false);}
  });
  el('s-apply').onclick=async()=>{try{C.dates(el('s-from').value,el('s-to').value);range={from:el('s-from').value,to:el('s-to').value};root.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('active'));await load(false);}catch(e){el('s-error').innerHTML='<div class="s-notice s-error">'+esc(e.message)+'</div>';}};
  el('s-refresh').onclick=()=>load(true);
  el('s-source').onchange=e=>{sourceFilter=e.target.value;render();};
  el('s-config').onsubmit=e=>{e.preventDefault();try{config=C.settings(Object.fromEntries(new FormData(e.target)));localStorage.setItem('ultera_summary_assumptions_v1',JSON.stringify(config));render();el('s-error').innerHTML='';}catch(e){el('s-error').innerHTML='<div class="s-notice s-error">'+esc(e.message)+'</div>';}};
  document.getElementById('logout-btn')?.addEventListener('click',()=>{requestVersion++;data=null;result=null;prior=null;config={...C.DEFAULTS};loaded=false;localStorage.removeItem('ultera_summary_assumptions_v1');root.querySelector('.s-settings').hidden=true;for(const input of el('s-config').querySelectorAll('input'))input.value='';el('s-content').innerHTML='';el('s-error').innerHTML='';});
  if(typeof ResizeObserver!=='undefined'){
    let lastWidth=0;
    new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(width!==lastWidth){lastWidth=width;if(result&&el('s-trend-cards'))renderTrendCards();}}).observe(root);
  }
  const link=document.querySelector('[data-page="summary"]');if(link)link.addEventListener('click',()=>load(false));
  if(window.ULTERA_SUMMARY_PREVIEW)load(false);
  else if(location.hash==='#summary'){const check=()=>{if(typeof SESSION!=='undefined'&&SESSION?.access_token){link?.click();clearInterval(timer);}};const timer=setInterval(check,700);setTimeout(()=>clearInterval(timer),20000);check();}
})();
