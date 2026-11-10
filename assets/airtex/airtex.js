(function(){
 'use strict';
 document.querySelectorAll('[data-airtex-toggle]').forEach(function(button){
  button.addEventListener('click',function(){
   var section=button.closest('.airtex');
   var wasOpen=button.getAttribute('aria-expanded')==='true';
   section.querySelectorAll('[data-airtex-toggle]').forEach(function(other){
    var open=other===button&&!wasOpen;
    other.setAttribute('aria-expanded',String(open));
    other.querySelector('i').textContent=open?'−':'+';
    document.getElementById(other.getAttribute('aria-controls')).hidden=!open;
   });
  });
 });
 var highFamilies=['Thermo','Hunk Thermo','Aganta Thermo','Hunk Thermo BRFT W','Travel Thermo','WAVE2 Thermo','Thermo Ked'];
 function profile(product){
  var family=String(product&&product.family||'').trim();
  if(!product||!family||/^(tees|insole|shape)$/i.test(family))return null;
  var high=highFamilies.some(function(f){return f.toLowerCase()===family.toLowerCase();});
  return {
   name:high?'AirTex+':'AirTex',high:high,temperature:high?'−18':'−7',
   image:high?'/assets/airtex/airtex-plus-gallery.jpg':'/assets/airtex/airtex-gallery.jpg'
  };
 }
 function isDiagram(src){return /\/assets\/airtex\/airtex(?:-plus)?-gallery\.jpg(?:[?#]|$)/i.test(String(src||''));}
 function gallery(product,photos){
  var info=profile(product);
  var clean=Array.from(new Set((photos||[]).filter(function(src){return typeof src==='string'&&!isDiagram(src);})));
  if(!info||!clean.length)return clean;
  return [clean[0],info.image].concat(clean.slice(1));
 }
 function imageAlt(src){
  if(!isDiagram(src))return '';
  return src.indexOf('airtex-plus-gallery')!==-1?
   'Утеплювач AirTex+ до −18 °C: щільна тканина, третій фольгований шар з мікроперфорацією, додатковий шар утеплення':
   'Утеплювач AirTex до −7 °C: щільна тканина та фольгований шар з мікроперфорацією';
 }
 function descriptionHTML(product){
  var info=profile(product);
  if(!info)return '';
  var intro=info.high?
   'Утеплювач AirTex+ із тканини високої щільності та додатковим шаром утеплення використовується у високих зимових моделях. Для температур до −18 °C.':
   'Утеплювач AirTex із тканини високої щільності використовується в зимових версіях низьких моделей ULTERA. Для температур до −7 °C.';
  var foil=info.high?
   'На пошаровій схемі AirTex+ третій шар — фольгований, з мікроперфорацією. Він допомагає відбивати тепло всередину та зменшувати тепловтрати. Додатковий тканинний утеплювач розташований під ним.':
   'Фольгований шар допомагає відбивати тепло всередину та зменшувати тепловтрати. Мікроперфорація у фольгованому шарі — для повітрообміну.';
  return '<div class="airtex-description"><h3>Утеплювач '+info.name+'</h3><p>'+intro+'</p><p>'+foil+'</p></div>';
 }
 function composeDescription(product,html){
  var info=profile(product),body=String(html||'');
  if(info&&info.high)body=body.replace(/(?:−|–|-)\s*15\s*°\s*[CС]/g,'−18 °C');
  return body+descriptionHTML(product);
 }
 function syncProduct(product,season){
  var details=document.getElementById('m_airtex');
  if(!details)return;
  var family=String(product&&product.family||'').trim();
  var high=highFamilies.indexOf(family)!==-1;
  var winter=high||season==='winter';
  var excluded=/^(tees|insole|shape|02|lite|hunk summer w)$/i.test(family);
  details.hidden=!product||!winter||excluded;
  if(details.dataset.uid!==String(product&&product.uid||'')){details.open=false;}
  details.dataset.uid=String(product&&product.uid||'');
  if(details.hidden){details.open=false;return;}
  var name=high?'AirTex+':'AirTex';
  var temperature=high?'−18':'−7';
  var diagram=details.querySelector('.airtex-product-visual img');
  var info=profile(product);
  if(diagram&&info){diagram.src=info.image;diagram.alt=imageAlt(info.image);diagram.width=1254;diagram.height=1254;}
  details.querySelector('[data-airtex-product-title]').textContent=name+' · до '+temperature+' °C — як працює утеплення';
  details.querySelector('[data-airtex-product-description]').textContent=high?
   'AirTex+ — термопідкладка з тканини високої щільності та додатковим шаром утеплення для високих моделей. Для температур до −18 °C.':
   'AirTex — термопідкладка з тканини високої щільності для низьких зимових моделей. Для температур до −7 °C.';
 }
 window.ulteraAirtex={syncProduct:syncProduct,gallery:gallery,imageAlt:imageAlt,descriptionHTML:descriptionHTML,composeDescription:composeDescription};
 if(window.__modalUid&&typeof window.findProduct==='function'){
  syncProduct(window.findProduct(window.__modalUid),window.__modalSeason);
 }
})();

