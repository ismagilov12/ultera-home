(function(){
 'use strict';
 var root=document.getElementById('reviews');
 if(!root)return;
 var cards=Array.from(root.querySelectorAll('[data-review-src]'));
 var dialog=document.getElementById('ulReviewDialog');
 if(!dialog||!cards.length)return;
 var image=dialog.querySelector('[data-review-image]');
 var counter=dialog.querySelector('[data-review-counter]');
 var error=dialog.querySelector('[data-review-error]');
 var rail=root.querySelector('[data-review-rail]');
 var index=0,opener=null,oldOverflow='',touch=null;
 var reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 function show(next){
  index=(next+cards.length)%cards.length;
  var card=cards[index];
  error.hidden=true;
  image.alt=card.querySelector('img').alt;
  image.src=card.dataset.reviewSrc;
  counter.textContent=(index+1)+' / '+cards.length;
  dialog.querySelector('[data-review-number]').textContent='Сторіс '+(index+1)+' з '+cards.length;
  [(index+1)%cards.length,(index+cards.length-1)%cards.length].forEach(function(i){var img=new Image();img.src=cards[i].dataset.reviewSrc;});
 }
 function open(i,button){
  opener=button;
  show(i);
  oldOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  dialog.showModal();
  dialog.querySelector('[data-review-close]').focus();
 }
 function close(){dialog.close();}
 cards.forEach(function(card,i){card.addEventListener('click',function(){open(i,card);});});
 dialog.querySelector('[data-review-close]').addEventListener('click',close);
 dialog.querySelector('[data-review-prev]').addEventListener('click',function(){show(index-1);});
 dialog.querySelector('[data-review-next]').addEventListener('click',function(){show(index+1);});
 dialog.addEventListener('close',function(){document.body.style.overflow=oldOverflow;if(opener)opener.focus({preventScroll:true});image.removeAttribute('src');});
 dialog.addEventListener('click',function(e){if(e.target===dialog)close();});
 dialog.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'){e.preventDefault();show(index+1);}
  if(e.key==='ArrowLeft'){e.preventDefault();show(index-1);}
 });
 image.addEventListener('error',function(){if(dialog.open)error.hidden=false;});
 image.addEventListener('load',function(){error.hidden=true;});
 var stage=dialog.querySelector('[data-review-stage]');
 stage.addEventListener('touchstart',function(e){touch=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true});
 stage.addEventListener('touchend',function(e){
  if(!touch||!e.changedTouches.length)return;
  var dx=e.changedTouches[0].clientX-touch.x,dy=e.changedTouches[0].clientY-touch.y;
  touch=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.5)show(index+(dx<0?1:-1));
 },{passive:true});
 root.querySelectorAll('[data-review-scroll]').forEach(function(button){button.addEventListener('click',function(){rail.scrollBy({left:Number(button.dataset.reviewScroll)*rail.clientWidth*.8,behavior:reduced.matches?'auto':'smooth'});});});
})();
