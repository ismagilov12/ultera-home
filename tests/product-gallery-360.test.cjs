'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {indexManifest,frameLayout,createPlayer}=require('../assets/catalog360/product-gallery.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const entry={uid:'one',name:'One',status:'prepared',frames:8,cols:4,rows:2,atlas:'atlases/one.webp'};
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
function rig(){
  const h={visible:true,events:[],tick:null,timers:0,last:'',errors:0,wait:defer(),count:0};
  const io={visible:()=>h.visible,load:()=>{h.count++;return h.wait.promise;},prepare:()=>h.events.push('prepare'),
    paint:(_,im,i)=>h.events.push('paint:'+i),state:(s,e)=>{h.last=s;h.offered=e?.uid;},
    schedule:fn=>{h.tick=fn;return ++h.timers;},cancel:()=>{h.tick=null;},delay:()=>950,failure:()=>h.errors++};
  h.player=createPlayer(io);h.player.setManifest([entry]);h.player.select('one');return h;
}
test('manifest only offers playable prepared models and valid aliases',()=>{
 const m=indexManifest([{...entry,aliases:['alias']},{...entry,uid:'broken',frames:9},{...entry,uid:'off',status:'draft'}]);
 assert.deepEqual([...m.keys()],['one','alias']);
});
test('one click starts at frame 0 then cycles; stop clears playback and returns to photos',async()=>{
 const h=rig();assert.equal(h.last,'photo');assert.equal(h.count,0);
 const go=h.player.toggle();assert.equal(h.last,'loading');h.wait.resolve({});await go;
 assert.equal(h.last,'360');assert.deepEqual(h.events,['prepare','paint:0']);assert.equal(h.timers,1);
 for(let i=0;i<8;i++)h.tick();assert.equal(h.events.at(-1),'paint:0');
 h.tick();h.player.resize();assert.equal(h.events.at(-1),'paint:1');await h.player.toggle();assert.equal(h.last,'photo');assert.equal(h.tick,null);
});
test('navigation, selecting a new color, and another click cancel late loads',async()=>{
 for(const kind of ['photo','color','toggle']){
   const h=rig(),go=h.player.toggle();
   if(kind==='photo')h.player.stop();else if(kind==='color')h.player.select('two');else await h.player.toggle();
   h.wait.resolve({});await go;assert.equal(h.last,'photo');assert.equal(h.timers,0);assert(!h.events.includes('paint:0'));
   if(kind==='color')assert.equal(h.offered,undefined);
 }
});
test('old atlas request cannot replace a newer run; hidden cards never start',async()=>{
 const h=rig(),old=h.wait,opening=h.player.toggle();h.player.stop();h.wait=defer();
 const next=h.player.toggle();h.wait.resolve({});await next;old.resolve({});await opening;
 assert.equal(h.timers,1);assert.deepEqual(h.events,['prepare','prepare','paint:0']);
 h.visible=false;h.tick();assert.equal(h.last,'photo');await h.player.toggle();assert.equal(h.count,2);
});
test('failed asset leaves original media usable and a deliberate retry can work',async()=>{
 const h=rig();const p=h.player.toggle();h.wait.reject(Error('offline'));await p;
 assert.equal(h.errors,1);assert.equal(h.last,'photo');assert.equal(h.tick,null);
 h.wait=defer();const p2=h.player.toggle();h.wait.resolve({});await p2;assert.equal(h.last,'360');
});
test('renderer preserves the calibrated Hunk3 scale and supports HQ and legacy atlases',()=>{
 const hunk={...entry,uid:'809858137952',atlas:'atlases/809858137952-v2-20261027.webp'};
 const im={naturalWidth:5016,naturalHeight:2508};
 for(const [w,h] of [[390,488],[740,510]]){
  const f0=frameLayout(hunk,im,0,w,h),f2=frameLayout(hunk,im,2,w,h);
  assert.equal(f0.draw[6],f2.draw[6]);assert.equal(f2.draw[0],2508);
  assert.throws(()=>frameLayout(hunk,{naturalWidth:999,naturalHeight:500},0,w,h));
  for(const e of [entry,{...entry,bounds:Array(8).fill({x:22,y:50,width:200,height:110})}])
   assert(frameLayout(e,im,7,w,h).draw.every(Number.isFinite));
 }
});
function listen(){const events=new Map();return {addEventListener(n,h){events.set(n,h);},emit(n,e){events.get(n)?.(e);}};}
const func=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));
function gestures({touch=false}={}){
 const calls=[],wrap=listen(),doc=listen(),win={__modalPhotos:['a.jpg','clip.mp4','b.jpg','c.jpg'],__modalPhotoIdx:0,
 ulteraGalleryMedia:{isVideo:u=>u.endsWith('.mp4')}};
 if(!touch)win.PointerEvent=function(){};
 win.setModalPhoto=i=>{calls.push(i);win.__modalPhotoIdx=i;};
 wrap.setPointerCapture=()=>{};doc.getElementById=id=>id==='m_img_wrap'?wrap:{classList:{contains:()=>true}};
 const scope={window:win,document:doc,Math,Date};vm.createContext(scope);
 vm.runInContext(func('function moveModalPhoto(delta){','function setModalPhoto(i){'),scope);
 vm.runInContext(func('/* ————— A single swipe owner','function addToCart(){'),scope);
 const event=(x,y,ctrl)=>({isPrimary:true,button:0,pointerId:8,pointerType:'touch',clientX:x,clientY:y,target:{closest:()=>ctrl?{}:null}});
 function swipe(dx,dy,ctrl=false){wrap.emit('pointerdown',event(160,160,ctrl));wrap.emit('pointerup',event(160+dx,160+dy,ctrl));}
 return {calls,wrap,doc,win,swipe,event};
}
test('swipe goes to the adjacent photograph in either direction, skips video, wraps once',()=>{
 const {swipe,calls,win}=gestures();swipe(-90,4);swipe(100,0);swipe(110,2);assert.deepEqual(calls,[2,0,3]);
 win.__modalPhotos=['sole.jpg'];win.__modalPhotoIdx=0;swipe(-55,0);assert.equal(calls.at(-1),0);
});
test('vertical scroll, small taps, toolbar controls, two-finger gestures and cancel do not browse',()=>{
 const {swipe,calls,wrap,event}=gestures();swipe(10,90);swipe(9,1);swipe(-100,0,true);
 wrap.emit('pointerdown',event(150,100));wrap.emit('pointerdown',{...event(160,110),isPrimary:false});
 wrap.emit('pointerup',event(10,100));
 wrap.emit('pointerdown',event(150,100));wrap.emit('pointercancel',{});wrap.emit('pointerup',event(10,100));
 assert.deepEqual(calls,[]);
});
test('touch-only fallback: one step for one swipe and no scroll suppression for vertical motion',()=>{
 const {calls,wrap}=gestures({touch:true});let prevented=0;
 const start={touches:[{identifier:1,clientX:150,clientY:100}],target:{closest:()=>null}};
 wrap.emit('touchstart',start);wrap.emit('touchend',{changedTouches:[{identifier:1,clientX:40,clientY:107}],cancelable:true,preventDefault:()=>prevented++});
 wrap.emit('touchstart',start);wrap.emit('touchend',{changedTouches:[{identifier:1,clientX:145,clientY:190}],cancelable:true,preventDefault:()=>prevented++});
 assert.deepEqual(calls,[2]);assert.equal(prevented,1);
});
test('actual thumbnail builder keeps media order, lazy image previews and direct selection at mobile width',()=>{
 const select=[],gal={replaceChildren(...buttons){this.buttons=buttons;},scrollLeft:78};
 function make(tag){return {tag,dataset:{},attrs:{},kids:[],classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,h){this[k]=h;},appendChild(x){this.kids.push(x);}};}
 const photos=['one.jpg','video.mp4','two.jpg'],scope={gal,p:{photo:'hero.jpg'},photos,document:{createElement:make},window:{
  matchMedia:()=>({matches:true}),setModalPhoto:i=>select.push(i),ulteraGalleryMedia:{preview:u=>u==='video.mp4'?{video:true,src:'poster.webp'}:{video:false,src:u}}
 }};
 vm.runInNewContext(func('  if (gal) {','  // counter-pill'),scope);
 assert.equal(gal.hidden,false);assert.equal(gal.buttons.length,3);assert.equal(gal.scrollLeft,0);
 assert.equal(gal.buttons[1].kids[0].src,'poster.webp');assert.equal(gal.buttons[1].kids[0].loading,'lazy');assert.equal(gal.buttons[1].kids.length,2);
 gal.buttons[2].click();assert.deepEqual(select,[2]);assert.equal(gal.buttons[2].attrs['aria-label'],'Фото 3 з 3');
 scope.photos=['only.jpg'];vm.runInNewContext(func('  if (gal) {','  // counter-pill'),scope);assert.equal(gal.hidden,true);
});
test('one product-card viewer, overlay toolbar, navigation cancellation, no mobile strip suppression',()=>{
 assert.equal((html.match(/src="\/assets\/catalog360\/product-gallery\.js[^"]*"/g)||[]).length,1);
 assert(!/<script[^>]+(?:hunk3-360\.js|aganta-oreo-360\.js|catalog360\/site-integration\.js)/.test(html));
 assert(!/\.modal-strip\s*\{\s*display:\s*none/.test(html));
 assert.match(html,/id="m_media_actions"[\s\S]{0,600}id="mVideoBtn"[\s\S]{0,550}id="ultera360Button"/);
 assert.match(html,/window\.setModalPhoto = function\(i\)\{\s*window\.ulteraCard360\?\.stop\(\);/);
 assert.match(html,/function closeModal\(\)\{\s*window\.ulteraCard360\?\.stop\(\);/);
 assert.match(html,/window\.__modalUid = p\.uid;\s*window\.ulteraCard360\?\.select\(p\.uid\);/);
});
test('all inline classic scripts in the production storefront still parse',()=>{
 let count=0;
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
  if(/\bsrc\s*=|\btype\s*=\s*["'](?:application\/(?:ld\+)?json|module|text\/plain)/i.test(m[1]))continue;
  new vm.Script(m[2]);count++;
 }
 assert(count>5);
});
