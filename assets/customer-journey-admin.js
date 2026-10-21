/* Admin-only order journey. The API verifies Auth + ULTERA admin membership. */
(function(){
  'use strict';
  const labels={page_view:'Візит на сайт',page_engagement:'Активність сторінки',product_view:'Перегляд моделі',color_view:'Зміна кольору',size_selected:'Вибір розміру',version_selected:'Вибір версії',size_guide_open:'Відкрито розмірну сітку',add_to_cart:'Додано в кошик',cart_quantity_changed:'Змінено кількість',remove_from_cart:'Видалено з кошика',cart_open:'Відкрито кошик',checkout_started:'Розпочато оформлення',checkout_step_view:'Екран оформлення',checkout_field_started:'Перехід до поля',checkout_field_completed:'Поле заповнено',checkout_validation_error:'Помилка перевірки',delivery_lookup_error:'Помилка пошуку доставки',checkout_submit_attempt:'Спроба оформити',checkout_submit_failed:'Помилка надсилання',checkout_submit_acknowledged:'Сайт отримав відповідь',checkout_draft_saved:'Сервер зберіг чернетку',order_saved:'Сервер зберіг замовлення',payment_redirect:'Перехід до оплати',payment_redirect_failed:'Перехід до оплати не вдався',scroll_depth:'Прокручування'};
  const fields={name:'ім’я',phone:'телефон',city:'місто',branch:'відділення',payment:'оплата'};
  const reasons={required:'не заповнено',invalid:'некоректний формат',not_selected:'не обрано зі списку',network_or_provider:'мережа або сервіс доставки',request_failed:'мережева помилка',server_rejected:'сервер відхилив',no_payment_form:'немає форми оплати'};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  dready();
  function dready(){document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-order-journey]');if(!button)return;e.preventDefault();e.stopPropagation();
    const target=button.parentElement.querySelector('[data-journey-body]');if(!target)return;
    button.disabled=true;target.textContent='Завантаження шляху…';
    try{
      await ensureFreshSession();
      const r=await fetch('/api/journey?order_id='+encodeURIComponent(button.dataset.orderJourney),{headers:{Authorization:'Bearer '+SESSION.access_token},cache:'no-store'});
      const result=await r.json();if(!r.ok)throw new Error(result.error||'Недоступно');
      if(!result.link){target.textContent='Історії немає: замовлення створене до підключення, без згоди на аналітику або в іншому браузері. Це не означає відсутність відвідувань.';return;}
      const catalog=new Map();
      for(const o of result.orders)for(const i of o.items)catalog.set(i.uid,i.title);
      const visits=new Set(result.events.map(x=>x.session_id));
      const details=data=>{
        const bits=[];
        if(data.uid)bits.push((catalog.get(data.uid)||'Товар '+data.uid)+(data.size?' · р. '+data.size:''));
        if(data.season_id)bits.push(data.season_id==='winter'?'Термо':data.season_id);
        if(data.field)bits.push(fields[data.field]||data.field);
        if(data.reason)bits.push(reasons[data.reason]||data.reason);
        if(data.payment_method)bits.push(data.payment_method==='np'?'Передплата / післяплата':'Картка');
        if(data.active_ms)bits.push(Math.round(data.active_ms/1000)+' с активності');
        if(data.scroll_pct)bits.push(data.scroll_pct+'%');
        if(data.total!=null)bits.push(Number(data.total).toLocaleString('uk-UA')+' ₴');return bits.join(' · ');
      };
      target.innerHTML='<p><b>Шлях браузера</b> · '+visits.size+' сес. · '+result.events.length+' подій<br><small>ID: '+esc(result.link.visitor_id)+'<br>Один браузер ≠ одна людина. Оплата й апрув — за статусами замовлення, не за кліками.</small></p>'+
        '<p>Перше джерело: '+esc(source(result.link.first_touch))+'<br>Останнє джерело: '+esc(source(result.link.last_touch))+'</p>'+
        '<div style="max-height:460px;overflow:auto"><table style="width:100%;font-size:12px"><thead><tr><th>Час · Київ</th><th>Подія</th><th>Деталі</th></tr></thead><tbody>'+result.events.map(x=>'<tr><td>'+esc(new Date(x.occurred_at).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'}))+'</td><td>'+esc(labels[x.event_type]||x.event_type)+(x.source==='server'?' ✓':'')+'</td><td>'+esc(details(x.event_data||{}))+'</td></tr>').join('')+'</tbody></table></div>'+
        '<p><b>Замовлення цього браузера</b><br>'+result.orders.map(o=>'#'+esc(o.number)+' · '+esc(o.status==='lead'?'чернетка':o.keycrm_status_name||o.status)+' · '+esc(Number(o.total).toLocaleString('uk-UA'))+' ₴ · '+esc(o.items.map(i=>i.title+(i.size?' / '+i.size:'')+(i.season_id==='winter'?' / термо':'')).join(', '))).join('<br>')+'</p>'+
        (result.truncated?'<p>Показано останні 500 подій і до 100 замовлень за доступний період.</p>':'');
    }catch(error){target.textContent=error.message;}finally{button.disabled=false;}
  });}
  function source(t){if(!t)return 'немає';return [t.utm_source,t.utm_medium,t.utm_campaign,t.utm_content,t.referrer_origin].filter(Boolean).join(' / ')||'Прямий / невідомо';}
})();
