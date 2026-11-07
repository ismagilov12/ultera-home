(function(){
 'use strict';
 var spriteURL='/assets/airtex/airtex-material-sprites-mobile.png';
 var spriteReady=null;
 var reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 function loadSprite(){
  if(!spriteReady)spriteReady=new Promise(function(resolve,reject){var img=new Image();img.onload=function(){resolve();};img.onerror=reject;img.src=spriteURL;}).catch(function(error){spriteReady=null;throw error;});
  return spriteReady;
 }
 function stack(plus){
  var root=document.createElement('div');root.className='airtex-stack';root.setAttribute('role','img');
  root.setAttribute('aria-label',plus?'AirTex+: чотири шари. Третій — фольгований, четвертий — додатковий тканинний утеплювач.':'AirTex: три шари. Щільна тканина та фольгований шар з мікроперфорацією.');
  var materials=plus?['lining','fabric','foil','fabric']:['lining','fabric','foil'];
  materials.forEach(function(type,i){
   var layer=document.createElement('span');layer.className='airtex-motion-layer';layer.setAttribute('aria-hidden','true');
   layer.style.setProperty('--offset',String(i-(materials.length-1)/2));layer.style.setProperty('--depth',String(materials.length-i));
   var material=document.createElement('span');material.className='airtex-motion-material airtex-motion-material--'+type;layer.appendChild(material);
   var label=document.createElement('span');label.className='airtex-material-label airtex-material-label--'+(i%2?'right':'left')+(type==='foil'?' airtex-material-label--foil':'');
   label.innerHTML='<small>0'+(i+1)+'</small><span>'+(type==='foil'?'Фольгований шар':i===0?'Термопідкладка':i===3?'Додатковий утеплювач':'Щільний утеплювач')+'</span>';layer.appendChild(label);root.appendChild(layer);
  });
  var shell=document.createElement('span');shell.className='airtex-shell';shell.setAttribute('aria-hidden','true');
  var cordura=document.createElement('span');cordura.className='airtex-motion-material airtex-motion-material--fabric airtex-cordura';shell.appendChild(cordura);
  var shellLabel=document.createElement('span');shellLabel.className='airtex-material-label airtex-material-label--right airtex-material-label--shell';shellLabel.innerHTML='<span>Вологостійка Cordura</span>';shell.appendChild(shellLabel);
  [[34,40,-1],[52,33,1],[68,47,1]].forEach(function(position,i){
   var impact=document.createElement('span');impact.className='airtex-water-impact';impact.style.left=position[0]+'%';impact.style.top=position[1]+'%';impact.style.setProperty('--water-delay',(i*.23)+'s');impact.style.setProperty('--run-direction',position[2]);
   ['drop','ripple','bead'].forEach(function(type){var water=document.createElement('span');water.className='airtex-water-'+type;impact.appendChild(water);});
   [-65,-35,0,35,65].forEach(function(angle){var splash=document.createElement('span');splash.className='airtex-water-splash';splash.style.setProperty('--splash-angle',angle+'deg');impact.appendChild(splash);});
   shell.appendChild(impact);
  });
  root.appendChild(shell);
  return root;
 }
 function makePlayer(plus,single,interactive){
  var root=document.createElement('div');root.className='airtex-motion'+(single?' airtex-motion--single':'');
  root.setAttribute('role','group');root.setAttribute('aria-label','Анімація шарів утеплення AirTex та захисту від вологи Cordura');
  var galleryPlayback=single&&interactive===false;
  root.dataset.motionView=reduced.matches&&!galleryPlayback?'expanded':'auto';root.dataset.motionPaused=String(reduced.matches&&!galleryPlayback);root.dataset.motionVisible=String(galleryPlayback&&!document.hidden);
  // Opening this gallery frame is the user's playback action, including on iOS.
  if(galleryPlayback)root.dataset.motionOptIn='true';
  if(single){var title=document.createElement('p');title.className='airtex-motion-title';title.innerHTML=(plus?'AirTex+':'AirTex')+'<span>до '+(plus?'−18':'−7')+' °C</span>';root.appendChild(title);}
  var stacks=document.createElement('div');stacks.className='airtex-motion-stacks';stacks.appendChild(stack(single?plus:false));if(!single)stacks.appendChild(stack(true));root.appendChild(stacks);
  var captions=document.createElement('div');captions.className='airtex-motion-captions';
  var thermalCaption=document.createElement('p');thermalCaption.className='airtex-thermal-caption';
  thermalCaption.innerHTML='<strong>'+(single?(plus?'AirTex+ · додатковий шар утеплення':'AirTex · термопідкладка'):'AirTex / AirTex+ · тепло у кожному шарі')+'</strong><span>Тканина високої щільності утримує тепло. Фольгований шар зменшує тепловтрати, а мікроперфорація забезпечує повітрообмін.</span>';captions.appendChild(thermalCaption);
  var waterCaption=document.createElement('p');waterCaption.className='airtex-water-caption';waterCaption.innerHTML='<strong>Вологостійка Cordura</strong><span>Зовнішній шар захищає від вологи. Бризки збираються в краплі та стікають із поверхні тканини.</span>';captions.appendChild(waterCaption);root.appendChild(captions);
  var controls=document.createElement('div');controls.className='airtex-motion-controls';
  var play=document.createElement('button');play.type='button';play.setAttribute('data-airtex-play','');
  var assemble=document.createElement('button');assemble.type='button';assemble.setAttribute('data-airtex-assemble','');
  function sync(){play.textContent=root.dataset.motionView==='auto'&&root.dataset.motionPaused!=='true'?'Пауза':'Відтворити';assemble.textContent=root.dataset.motionView==='assembled'?'Розкласти шари':'Зібрати шари';}
  play.addEventListener('click',function(){root.dataset.motionOptIn='true';if(root.dataset.motionView!=='auto'){root.dataset.motionView='auto';root.dataset.motionPaused='false';}else root.dataset.motionPaused=String(root.dataset.motionPaused!=='true');sync();});
  assemble.addEventListener('click',function(){root.dataset.motionOptIn='true';root.dataset.motionView=root.dataset.motionView==='assembled'?'expanded':'assembled';root.dataset.motionPaused='true';sync();});
  controls.appendChild(play);controls.appendChild(assemble);if(interactive!==false)root.appendChild(controls);sync();
  var cleanups=[],observer=null;
  var onVisibility=function(){
   var rect=root.getBoundingClientRect();
   root.dataset.motionVisible=String(!document.hidden&&(galleryPlayback||(rect.bottom>0&&rect.top<window.innerHeight)));
  };
  document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pageshow',onVisibility);
  cleanups.push(function(){document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pageshow',onVisibility);});
  var visibilityFrame=requestAnimationFrame(function(){
   onVisibility();
   if(!galleryPlayback&&typeof IntersectionObserver==='function'){
    observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){root.dataset.motionVisible=String(entry.isIntersecting&&!document.hidden);});},{threshold:.05});observer.observe(root);
   }
  });
  cleanups.push(function(){cancelAnimationFrame(visibilityFrame);if(observer)observer.disconnect();});
  if(galleryPlayback){
   function fitGallery(){
    if(!root.parentElement)return;
    var box=root.parentElement.getBoundingClientRect();if(!(box.width>0&&box.height>0))return;
    root.style.height=Math.round(box.height)+'px';
    var title=root.querySelector('.airtex-motion-title'),titleHeight=title?title.getBoundingClientRect().height:0;
    var available=Math.max(100,box.height-44-titleHeight-captions.getBoundingClientRect().height);
    stacks.style.height=Math.floor(available)+'px';
    var width=stacks.getBoundingClientRect().width,materialWidth=Math.min(width*.9,available*1.1);
    root.style.setProperty('--airtex-material-width',materialWidth.toFixed(2)+'px');
    root.style.setProperty('--airtex-material-inset',((width-materialWidth)/2).toFixed(2)+'px');
    root.style.setProperty('--airtex-gallery-spread',Math.min(48,available*.14).toFixed(2)+'px');
   }
   var fitObserver=null,fitFrame=requestAnimationFrame(function(){fitGallery();if(typeof ResizeObserver==='function'&&root.parentElement){fitObserver=new ResizeObserver(fitGallery);fitObserver.observe(root.parentElement);fitObserver.observe(captions);}});
   window.addEventListener('resize',fitGallery);
   cleanups.push(function(){cancelAnimationFrame(fitFrame);if(fitObserver)fitObserver.disconnect();window.removeEventListener('resize',fitGallery);});
  }
  root._airtexCleanup=function(){cleanups.forEach(function(cleanup){cleanup();});};
  return root;
 }
 function discard(player){if(player&&typeof player._airtexCleanup==='function')player._airtexCleanup();if(player)player.remove();}
 function mount(container,single){
  if(!container)return;
  var poster=container.querySelector(':scope > img');if(!poster)return;
  var plus=single&&poster.getAttribute('src').indexOf('airtex-plus-gallery')!==-1;
  var kind=single?(plus?'plus':'base'):'both';
  var current=container.querySelector(':scope > .airtex-motion');
  if(current&&current.dataset.kind===kind)return;
  if(container.dataset.motionLoading==='true')return;
  container.dataset.motionLoading='true';
  loadSprite().then(function(){
   container.dataset.motionLoading='false';
   var old=container.querySelector(':scope > .airtex-motion');discard(old);
   var player=makePlayer(plus,single);player.dataset.kind=kind;container.insertBefore(player,poster);poster.hidden=true;
  }).catch(function(){container.dataset.motionLoading='false';poster.hidden=false;});
 }
 var visual=document.querySelector('#airtex .airtex-visual');
 if(visual){
  if(typeof IntersectionObserver==='function'){
   var lazy=new IntersectionObserver(function(entries){if(entries.some(function(e){return e.isIntersecting;})){mount(visual,false);lazy.disconnect();}},{rootMargin:'250px'});lazy.observe(visual);
  }else mount(visual,false);
 }
 var details=document.getElementById('m_airtex');
 if(details){details.addEventListener('toggle',function(){if(details.open)mount(details.querySelector('.airtex-product-visual'),true);});if(details.open)mount(details.querySelector('.airtex-product-visual'),true);}
 var wrap=document.getElementById('m_img_wrap'),modal=document.getElementById('modal');
 var selected='',epoch=0,overlay=null;
 function hideGallery(){
  if(overlay){discard(overlay.querySelector('.airtex-motion'));overlay.hidden=true;}
  if(wrap)wrap.removeAttribute('data-airtex-gallery');
 }
 function selectPhoto(src){
  selected=String(src||'');epoch++;hideGallery();
  if(!overlay)return;
  if(/\/assets\/airtex\/airtex(?:-plus)?-gallery\.jpg(?:[?#]|$)/i.test(selected)){wrap.dataset.airtexGallery='true';showGallery();}
 }
 function showGallery(){
  if(!overlay)return;
  var ticket=++epoch,src=selected;
  loadSprite().then(function(){
   if(ticket!==epoch||selected!==src||!modal.classList.contains('open'))return;
   window.ulteraCard360?.stop();
   discard(overlay.querySelector('.airtex-motion'));
   overlay.appendChild(makePlayer(src.indexOf('airtex-plus-gallery')!==-1,true,false));overlay.hidden=false;
  }).catch(function(){if(ticket!==epoch)return;hideGallery();});
 }
 if(wrap&&modal){
  overlay=document.createElement('div');overlay.className='airtex-gallery-motion';overlay.hidden=true;wrap.appendChild(overlay);
  document.addEventListener('click',function(event){if(event.target.closest?.('#mVideoBtn,#ultera360Button')){epoch++;hideGallery();}},true);
  new MutationObserver(function(){if(!modal.classList.contains('open'))selectPhoto('');else loadSprite().catch(function(){});}).observe(modal,{attributes:true,attributeFilter:['class']});
  var main=wrap.querySelector('#m_img');if(main)selectPhoto(main.getAttribute('src'));
 }
 window.ulteraAirtexMotion={selectPhoto:selectPhoto};
})();
