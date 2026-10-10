'use strict';
// Server-only, read-only KeyCRM adapter. Never return buyer details or provider keys.
// API contract: https://docs.keycrm.app/api.yaml (UTC dates; max 50 rows, 20 requests/min).
const BASE='https://openapi.keycrm.app/v1';
const defined=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n));
const round=n=>Math.round(n*100)/100;
function utc(value){
  if(!value)return null;
  const s=String(value).trim().replace(' ','T');
  const d=new Date(/(?:Z|[+-]\d\d:?\d\d)$/i.test(s)?s:s+'Z');
  return Number.isFinite(+d)?d.toISOString():null;
}
function publicError(code,message){const error=new Error(message);error.publicCode=code;return error;}
function variant(name,season,footwear){
  const text=String(name||'')+' '+String(season||'');
  if(/устіл|стельк|insole/i.test(text))return 'insole';
  if(!footwear)return 'other';
  if(/(?:hunk|aganta|travel|wave2)\s*thermo|thermo\s*ked|термо\s*(?:бот|кед)/i.test(text))return 'boot';
  if(/термо|thermo|зим|winter/i.test(text))return 'thermal';
  if(/осін|осен|весн|демі|деми|літн|летн|autumn|spring|summer/i.test(text))return 'standard';
  return 'unknown';
}
function createReader({fetcher,token,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clock=()=>Date.now()}){
  let lastRequest=null,requests=0;
  async function get(path,params){
    // Per-request pacing, not a process cache. A shared-token 429 is surfaced safely.
    if(++requests>45)throw publicError('CRM_RANGE_TOO_LARGE','Забагато даних KeyCRM. Оберіть коротший період (до 30 днів).');
    if(lastRequest!==null)await sleep(Math.max(0,3100-(clock()-lastRequest)));
    lastRequest=clock();
    const response=await fetcher(BASE+path+'?'+new URLSearchParams(params),{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
    if(response.status===429)throw publicError('CRM_RATE_LIMIT','KeyCRM тимчасово обмежив частоту запитів. Зачекайте хвилину й натисніть «Оновити дані».');
    if(!response.ok)throw publicError('CRM_UNAVAILABLE','Не вдалося прочитати KeyCRM. Повна сводка не підміняється замовленнями лише сайту.');
    const body=await response.json();
    if(!Array.isArray(body.data))throw publicError('CRM_RESPONSE_INVALID','KeyCRM повернув неповну відповідь. Результати приховано.');
    return body;
  }
  async function pages(path,params,maxPages=32){
    const rows=[],ids=new Set();let expected=null;
    for(let page=1;page<=maxPages;page++){
      const body=await get(path,{...params,limit:'50',page:String(page)});
      if(defined(body.current_page)&&Number(body.current_page)!==page)throw publicError('CRM_PAGINATION_INVALID','Не вдалося перевірити всі сторінки KeyCRM. Скоротіть період.');
      if(defined(body.total))expected=Number(body.total);
      for(const row of body.data){if(!row.id||ids.has(String(row.id)))throw publicError('CRM_PAGINATION_CHANGED','Список KeyCRM змінився під час завантаження. Оновіть дані.');ids.add(String(row.id));rows.push(row);}
      const done=defined(body.last_page)?page>=Number(body.last_page):body.data.length<50;
      if(done){if(expected!==null&&expected!==rows.length)throw publicError('CRM_PAGINATION_CHANGED','Кількість замовлень KeyCRM змінилася. Оновіть дані.');return rows;}
    }
    throw publicError('CRM_RANGE_TOO_LARGE','Забагато даних KeyCRM. Оберіть коротший період (до 30 днів).');
  }
  return {pages};
}
function normalizeCRM(rows,catalog,sources,siteSourceId,fetchedAt){
  const products=new Map(catalog.map(p=>[Number(p.id),p]));
  const sourceMap=new Map(sources.map(s=>[Number(s.id),s]));
  const customers=new Map();let nextCustomer=1,tests=0,unknownCategoryUnits=0,unknownSizeUnits=0,unknownCurrencyOrders=0;
  const orders=[];
  for(const o of rows){
    if(Number(o.status_id)===99||/(?:^|[\s_-])(?:qa|test|тест)(?=$|[\s_\d-])/iu.test(String(o.buyer?.full_name||''))){tests++;continue;}
    if(!defined(o.grand_total)||!utc(o.ordered_at||o.created_at)||!Array.isArray(o.products))throw publicError('CRM_ORDER_INCOMPLETE','У KeyCRM є замовлення без суми, дати або товарів. Підсумки приховано до перевірки.');
    const source=sourceMap.get(Number(o.source_id));
    if(source?.currency_code!=='UAH')unknownCurrencyOrders++;
    // Exact normalized full phone, then CRM buyer ID. No suffix collision or public hash.
    let phone=String(o.buyer?.phone||'').replace(/\D/g,'');if(phone.length===10&&phone[0]==='0')phone='38'+phone;
    const identity=phone.length>=10?'phone:'+phone:o.buyer?.id?'buyer:'+o.buyer.id:'order:'+o.id;
    if(!customers.has(identity))customers.set(identity,String(nextCustomer++));
    const items=o.products.map(p=>{
      if(!defined(p.quantity)||Number(p.quantity)<0||!defined(p.price_sold))throw publicError('CRM_ITEM_INCOMPLETE','У KeyCRM немає кількості або ціни продажу позиції. Фінансові підсумки приховано.');
      const product=products.get(Number(p.offer?.product_id));
      const properties=[...(p.properties||[]),...(p.offer?.properties||[])];
      const attribute=re=>properties.find(v=>re.test(String(v.name)))?.value;
      const size=attribute(/розмір|размер|size/i);
      const season=attribute(/сезон|season|утепл|верс|version/i);
      const title=String(product?.name||p.name||'Товар без назви');
      const category=product?.category_id;
      if(category===null||category===undefined)unknownCategoryUnits+=Number(p.quantity);
      if(Number(category)===22&&!size)unknownSizeUnits+=Number(p.quantity);
      const insole=/устіл|стельк|insole/i.test(title);
      return {uid:product?'crm-product:'+product.id:'crm-name:'+String(p.name||p.sku),sku:String(p.sku||''),title,
        size:size?String(size):'Не вказано',season:season?String(season):'',qty:Number(p.quantity),price:Number(p.price_sold),
        purchased_price:defined(p.purchased_price)?Number(p.purchased_price):null,
        product_revenue:round(Number(p.price_sold)*Number(p.quantity)),category_id:category??null,
        is_footwear:Number(category)===22,family:insole?'Insole':Number(category)===22?'':'Other',
        crm_item:true,kind_hint:variant(String(p.name||title),season,Number(category)===22)};
    });
    orders.push({id:'crm-'+o.id,keycrm_id:o.id,created_at:utc(o.ordered_at||o.created_at),updated_at:utc(o.updated_at),
      keycrm_status_id:Number(o.status_id),total:Number(o.grand_total),items,
      source_id:Number(o.source_id),source_name:String(source?.name||'Джерело '+o.source_id),
      customer_key:customers.get(identity),campaign_tag:o.marketing?.utm_campaign||null,
      delivery_city:String(o.shipping?.shipping_address_city||''),keycrm_synced_at:fetchedAt,
      // Kept separate from general operating costs to avoid silently deducting twice.
      crm_expenses:defined(o.expenses_sum)?Number(o.expenses_sum):0});
  }
  return {orders,sources:sources.map(s=>({id:Number(s.id),name:String(s.name),site:Number(s.id)===siteSourceId})),
    quality:{excludedTests:tests,unknownCategoryUnits,unknownSizeUnits,unknownCurrencyOrders}};
}
async function loadCRM({fetcher,token,start,end,siteSourceId,fetchedAt,sleep,clock}){
  if(!token)throw publicError('CRM_NOT_CONFIGURED','Серверний доступ до KeyCRM не налаштовано. Дані лише сайту не видаються за всю CRM.');
  const reader=createReader({fetcher,token,sleep,clock});
  const format=d=>new Date(d).toISOString().slice(0,19).replace('T',' ');
  const rows=await reader.pages('/order',{include:'buyer,products.offer,status,marketing,shipping',sort:'id',
    'filter[created_between]':format(start)+','+format(new Date(Date.parse(end)-1000))});
  const sources=await reader.pages('/order/source',{sort:'id'},4);
  const productIds=[...new Set(rows.flatMap(o=>(o.products||[]).map(p=>p.offer?.product_id)).filter(Boolean))];
  const catalog=[];
  for(let i=0;i<productIds.length;i+=50)catalog.push(...await reader.pages('/products',{'filter[product_id]':productIds.slice(i,i+50).join(',')},4));
  const result=normalizeCRM(rows,catalog,sources,siteSourceId,fetchedAt);
  // Validate the server-side filter against the same UTC interval; never silently drop rows.
  if(result.orders.some(o=>o.created_at<start||o.created_at>=end))throw publicError('CRM_DATE_MISMATCH','Дати відповіді KeyCRM не збігаються з вибраним періодом. Підсумки приховано.');
  return result;
}
module.exports={loadCRM,normalizeCRM,createReader,utc,variant};
