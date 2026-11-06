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
 var highFamilies=['Thermo','Hunk Thermo','Aganta Thermo','Hunk Thermo BRFT W','Travel Thermo','WAVE2 Thermo'];
 function syncProduct(product,season){
  var details=document.getElementById('m_airtex');
  if(!details)return;
  var family=String(product&&product.family||'').trim();
  var high=highFamilies.indexOf(family)!==-1;
  var lowNative=family==='Thermo Ked';
  var winter=high||lowNative||season==='winter';
  var excluded=/^(tees|insole|shape|02|lite|hunk summer w)$/i.test(family);
  details.hidden=!product||!winter||excluded;
  if(details.dataset.uid!==String(product&&product.uid||'')){details.open=false;}
  details.dataset.uid=String(product&&product.uid||'');
  if(details.hidden){details.open=false;return;}
  var name=high?'AirTex+':'AirTex';
  var temperature=high?'−18':'−7';
  details.querySelector('[data-airtex-product-title]').textContent=name+' · до '+temperature+' °C — як працює утеплення';
  details.querySelector('[data-airtex-product-description]').textContent=high?
   'AirTex+ — термопідкладка з тканини високої щільності та додатковим шаром утеплення для високих моделей. Для температур до −18 °C.':
   'AirTex — термопідкладка з тканини високої щільності для низьких зимових моделей. Для температур до −7 °C.';
 }
 window.ulteraAirtex={syncProduct:syncProduct};
 if(window.__modalUid&&typeof window.findProduct==='function'){
  syncProduct(window.findProduct(window.__modalUid),window.__modalSeason);
 }
})();
