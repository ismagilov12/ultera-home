const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const html=read('index.html'), offer=read('assets/insole-upsell.js'), uid='900000000249';
const between=(start,end)=>{const a=html.indexOf(start), b=html.indexOf(end,a+start.length); assert.ok(a>=0 && b>a); return html.slice(a,b);};
const shoe=(size='42')=>({uid:'809858137952',family:'Hunk3',size,qty:1,price:4590});
class El {
  constructor(){this.children=[];this.events={};this.style={};this.hidden=false;this.textContent='';}
  appendChild(n){this.children.push(n);return n;} replaceChildren(){this.children=[];}
  addEventListener(k,f){this.events[k]=f;} setAttribute(k,v){this[k]=v;} focus(){this.focused=true;}
  find(c){if(this.className===c)return this;return this.children.map(n=>n.find(c)).find(Boolean);}
  click(){if(!this.disabled)this.events.click?.();} change(value){this.value=value;this.events.change?.();}
}
async function start(items,wizard={}){
  const root=new El(),cta=new El(),wrap=new El(),step=new El();step.style.display='none';
  const cart={items,wizard:{...wizard},saveWiz(){this.saved={...this.wizard};},add(it){this.items.push({...it,qty:1});},save(){}};
  const win={};let lookups=0;
  const doc={getElementById:k=>({cdInsoleUpsell:root,cdListWrap:wrap,cdWizard:step})[k],createElement:()=>new El(),querySelector:()=>cta};
  const ctx={CART:cart,window:win,document:doc,updateCartBadge(){},renderCart(){win.ULTERA_INSOLES.render();},
    fetch:async()=>{lookups++;return {ok:true,json:async()=>({ok:true,product:{uid,title:'Устілки',photo:'',family:'Insole',price:249}})};}};
  vm.runInNewContext(offer,ctx);await new Promise(r=>setImmediate(r));
  return {root,cart,cta,render:()=>win.ULTERA_INSOLES.render(),lookups:()=>lookups};
}
test('no is a cart preference: hides the whole offer without changing shoes, price, or form fields, including after reload',async()=>{
  const v=await start([shoe(),shoe('43')],{step:'form'});
  const original=JSON.stringify(v.cart.items);assert.equal(v.root.hidden,false);
  assert.equal(v.root.find('cd-insole-decline').textContent,'Ні, дякую');
  v.root.find('cd-insole-decline').click();v.render();
  assert.equal(v.root.hidden,true);assert.equal(v.cta.focused,true);
  assert.equal(JSON.stringify(v.cart.items),original);assert.equal(v.cart.saved.step,'form');
  const re=await start(v.cart.items,v.cart.saved);assert.equal(re.root.hidden,true);assert.equal(re.lookups(),0);
  re.cart.items=[];re.render();assert.equal(re.cart.saved.insoleOfferDeclined,undefined);
  re.cart.items=[shoe('41')];re.render();await new Promise(r=>setImmediate(r));assert.equal(re.root.hidden,false);
  assert.match(html,/if\(CART.items.length === 0\)\{[^}]*ULTERA_INSOLES\?\.render\(\)/);
});
test('yes adds one priced accessory in the chosen size; hiding never removes an already-added line',async()=>{
  const v=await start([shoe(),shoe('43')]);const select=v.root.find('cd-insole-size').children.find(x=>x.id==='cdInsoleSize');
  select.change('43');const add=v.root.find('cd-insole-add');assert.match(add.textContent,/249/);
  add.click();add.click();assert.equal(v.cart.items.length,3);
  assert.equal(v.cart.items[2].uid,uid);assert.equal(v.cart.items[2].size,'43');assert.equal(v.cart.items[2].price,249);
  assert.equal(v.root.find('cd-insole-add').disabled,true);
  assert.equal(v.root.find('cd-insole-decline').textContent,'Сховати пропозицію');
  v.root.find('cd-insole-decline').click();assert.equal(v.cart.items.length,3);
});
const pilotFns=between('function isYu11Card(','function openModal(uid)');
const buyFn=between('function addToCart(){','/* ————— CART DRAWER + WIZARD');
const seasonFn=between('function pickSeason(btn, id, label){','function syncModalThumbnails(idx)');
function fixture(){
  const ids=Object.fromEntries(['modal','m_sizes','m_size_block','m_price','m_season_name','m_buy','yu11Price','yu11Action'].map(x=>[x,{}]));
  const selBtn={dataset:{sz:'42'},focus(){this.focused=true;}};let selected=null,priced='4 590 ₴',added=[];
  ids.modal.classList={contains:n=>n==='yu11-purchase'};ids.m_sizes.querySelector=()=>selBtn;
  ids.m_sizes.scrollIntoView=()=>{ids.m_sizes.scrolled=true;};
  Object.defineProperty(ids.m_price,'innerHTML',{set(v){priced=v.match(/class="cur">([^<]+)/)[1];}});
  const doc={getElementById:k=>ids[k],querySelector:s=>s.includes('size-btn.selected')?selected:s==='#m_price .cur'?{textContent:priced}:s==='#m_sizes button:not(:disabled)'?selBtn:null,querySelectorAll:()=>[]};
  const win={__modalUid:'809858137952',matchMedia:()=>({matches:true})};
  const ctx=vm.createContext({window:win,document:doc,currentColor:win.__modalUid,findProduct:()=>({uid:win.__modalUid,title:'ULTERA - Hunk3 allBlack',price:4590,family:'Hunk3'}),isSoldOut:()=>false,isNativeThermoFamily:()=>false,winterExtra:(_,s)=>s==='winter'?900:0,priceNum:n=>String(n),CART:{add:i=>added.push(i)},toast(){},closeModal(){},openCart(){},updateCartBadge(){},setTimeout(){}});
  vm.runInContext(pilotFns+seasonFn+buyFn,ctx);
  return {ctx,win,ids,selBtn,added,select(){selected=selBtn;}};
}
test('Yu11 only: no silent default, available sizes only, desktop and sticky CTA share the cart action',()=>{
  const f=fixture();
  assert.equal(f.ctx.isYu11Card('809858137952'),true);assert.equal(f.ctx.isYu11Card('806938391602'),true);assert.equal(f.ctx.isYu11Card('924701650982'),false);
  const sizeUI=between('  const sizes = p.size_list || [];\n  document.getElementById(\'m_sizes\')','  const variants = row ? row.variants');
  function buttons(pilot,chosenEU){
    const root={};vm.runInNewContext(sizeUI,{p:{size_list:[{eu:'38',qty:5},{eu:'39',qty:0},{eu:'40',qty:2}]},yu11:pilot,chosenEU,document:{getElementById:()=>root,querySelectorAll:()=>[]}});return root.innerHTML;
  }
  assert.doesNotMatch(buttons(true,null),/size-btn selected/);
  assert.doesNotMatch(buttons(true,'39'),/size-btn selected/);
  assert.match(buttons(true,'38'),/size-btn selected [^>]+data-sz="38"/);
  assert.match(buttons(false,null),/size-btn selected [^>]+data-sz="40"/);
  f.ctx.syncYu11Purchase();assert.equal(f.ids.yu11Action.textContent,'Обрати розмір');
  f.ctx.addToCart();assert.equal(f.added.length,0);assert.ok(f.selBtn.focused && f.ids.m_sizes.scrolled);
  assert.match(html,/id="yu11Action" onclick="addToCart\(\)"/);
});
test('switching autumn/winter preserves the explicit size, mirrors the price, and adds exactly one correct pair',()=>{
  const f=fixture(),btn={classList:{add(){}}};f.select();
  f.ctx.pickSeason(btn,'winter','термо');assert.equal(f.ids.yu11Price.textContent,'5490 ₴');assert.equal(f.ids.yu11Action.textContent,'Додати в кошик · 42');
  f.ctx.pickSeason(btn,'autumn','осінь');assert.equal(f.ids.yu11Price.textContent,'4590 ₴');
  f.ctx.addToCart();assert.equal(f.added.length,1);assert.equal(f.added[0].size,'42');assert.equal(f.added[0].seasonId,'autumn');assert.equal(Number(f.added[0].price),4590);
});
