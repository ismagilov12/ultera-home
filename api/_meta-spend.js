'use strict';
// Server-only: no customer data and no write actions against Meta.
const ACCOUNT = '1095942551692734';
const SOURCE_TZ = 'America/Los_Angeles';
const TARGET_TZ = 'Europe/Kyiv';
const HOUR = 'hourly_stats_aggregated_by_advertiser_time_zone';
const FIELDS = ['date', 'account_id', 'account_currency', 'account_timezone', 'spend', 'data_fetched_at'];
const formatters = new Map();
function zonedParts(value, timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23'}));
  const p = Object.fromEntries(formatters.get(timeZone).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return {date:p.year+'-'+p.month+'-'+p.day, hour:Number(p.hour)};
}
function shiftDate(date, days) { return new Date(Date.parse(date+'T12:00:00Z') + days*86400000).toISOString().slice(0,10); }
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) fail('META_INVALID_TIMESTAMP');
  const t = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value+'Z');
  if (!Number.isFinite(t)) fail('META_INVALID_TIMESTAMP');
  return new Date(t).toISOString();
}
function sourceRow(r, from, to, now) {
  if (String(r.account_id) !== ACCOUNT || r.account_currency !== 'USD') fail('META_WRONG_ACCOUNT_OR_CURRENCY');
  if (r.account_timezone !== SOURCE_TZ) fail('META_WRONG_TIMEZONE');
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date < from || r.date > to || shiftDate(r.date,0) !== r.date) fail('META_INVALID_DATE');
  if (!['number','string'].includes(typeof r.spend) || String(r.spend).trim() === '' || !Number.isFinite(Number(r.spend)) || Number(r.spend) < 0) fail('META_INVALID_SPEND');
  const fetched = timestamp(r.data_fetched_at);
  if (Date.parse(fetched) > now.getTime()+300000) fail('META_FUTURE_TIMESTAMP');
  return {...r, spend:Number(r.spend), fetched};
}
function payloadRows(body) {
  if (!body || body.error || body.errors || (body.status && body.status !== 'done') || !Array.isArray(body.data)) fail('META_RESPONSE_INCOMPLETE');
  if (body.total_rows !== undefined && Number(body.total_rows) !== body.data.length) fail('META_RESPONSE_TRUNCATED');
  if (body.next || body.next_page || body.next_cursor || body.has_more) fail('META_RESPONSE_TRUNCATED');
  return body.data;
}
function aggregate(hourly, controls, {from, to, now=new Date()}) {
  const sourceFrom=shiftDate(from,-1), sourceTo=zonedParts(now,SOURCE_TZ).date;
  const daily=new Map(), hours=new Map(), sums=new Map(), target=new Map();
  for (const raw of controls) {
    const r=sourceRow(raw,sourceFrom,sourceTo,now);
    if (daily.has(r.date)) fail('META_DUPLICATE_DAY');
    daily.set(r.date,r);
  }
  for (const raw of hourly) {
    const r=sourceRow(raw,sourceFrom,sourceTo,now), m=/^(\d{2}):00:00 - \1:59:59$/.exec(r[HOUR]||'');
    if (!m || Number(m[1])>23) fail('META_INVALID_HOUR');
    const hour=Number(m[1]), key=r.date+' '+hour;
    if (hours.has(key)) fail('META_DUPLICATE_HOUR');
    hours.set(key,r); sums.set(r.date,(sums.get(r.date)||0)+r.spend);
    const wall=Date.parse(r.date+'T'+m[1]+':00:00Z');
    // The account is Pacific. Both fall-back occurrences belong to the same
    // Kyiv day; Meta reports their combined spend in a single hour bucket.
    const candidates=[7,8].map(offset=>wall+offset*3600000).filter(t=>{
      const p=zonedParts(t,SOURCE_TZ); return p.date===r.date&&p.hour===hour;
    });
    const days=[...new Set(candidates.map(t=>zonedParts(t,TARGET_TZ).date))];
    if (days.length!==1) fail('META_TIMEZONE_AMBIGUOUS');
    const date=days[0]; if(date<from||date>to)continue;
    const item=target.get(date)||{spend:0,fetched:r.fetched};
    item.spend+=r.spend; if(r.fetched<item.fetched)item.fetched=r.fetched;
    target.set(date,item);
  }
  for (const [date,total] of daily) {
    // The current Pacific day may advance between the two reads. Historical
    // days must reconcile; missing hours must never silently erase expenses.
    if (date<sourceTo && Math.abs((sums.get(date)||0)-total.spend)>0.03) fail('META_TOTAL_MISMATCH');
  }
  for (const date of sums.keys()) if(!daily.has(date)) fail('META_MISSING_CONTROL');
  const out=[];
  for(let date=from;date<=to;date=shiftDate(date,1)) {
    const required=new Set();
    // Enumerate UTC hours around a Kyiv day, including 23/25-hour DST days.
    const midnight=Date.parse(date+'T00:00:00Z');
    for(let h=-4;h<25;h++) {
      const t=midnight+h*3600000;
      if(t>now.getTime()||zonedParts(t,TARGET_TZ).date!==date)continue;
      required.add(zonedParts(t,SOURCE_TZ).date);
    }
    if(!required.size||[...required].some(d=>!daily.has(d))) continue;
    const item=target.get(date);
    // Explicit daily zeros may fill an empty target day. Absence is not zero.
    if(!item&&[...required].some(d=>daily.get(d).spend!==0)) continue;
    const fetched=[item?.fetched,...[...required].map(d=>daily.get(d).fetched)].filter(Boolean).sort()[0];
    // Is the source snapshot at least past the end of this Kyiv day?
    const complete=zonedParts(fetched,TARGET_TZ).date>date;
    out.push({account_id:ACCOUNT,date,spend_usd:Math.round((item?.spend||0)*1e6)/1e6,timezone:TARGET_TZ,fetched_at:fetched,
      source:'Windsor.ai hourly auto v1; Pacific -> Kyiv; '+(complete?'complete day':'partial day')});
  }
  if(!out.length)fail('META_NO_VERIFIED_DAYS');
  return out;
}
async function syncSpend({fetcher=globalThis.fetch,env=process.env,now=new Date()}={}) {
  if(!env.WINDSOR_API_KEY||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)fail('META_NOT_CONFIGURED');
  const to=zonedParts(now,TARGET_TZ).date, from=shiftDate(to,-6), sourceFrom=shiftDate(from,-1), sourceTo=zonedParts(now,SOURCE_TZ).date;
  async function read(fields) {
    const url=new URL('https://connectors.windsor.ai/facebook');
    url.search=new URLSearchParams({api_key:env.WINDSOR_API_KEY,fields:fields.join(','),date_from:sourceFrom,date_to:sourceTo,select_accounts:ACCOUNT,_renderer:'json',_max_rows:'10000'}).toString();
    let r;
    try {r=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(90000),headers:{Accept:'application/json'}});} catch {fail('META_SOURCE_UNAVAILABLE');}
    if(!r.ok)fail(r.status===401||r.status===403?'META_SOURCE_ACCESS':r.status===429?'META_SOURCE_RATE_LIMIT':'META_SOURCE_UNAVAILABLE');
    try{return payloadRows(await r.json());}catch(e){if(e.code)throw e;fail('META_INVALID_RESPONSE');}
  }
  const [hourly,daily]=await Promise.all([read([...FIELDS,HOUR]),read(FIELDS)]);
  const rows=aggregate(hourly,daily,{from,to,now});
  const base=env.SUPABASE_URL.replace(/\/$/,''), headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
  const saved=[],skipped=[];
  for(const row of rows) {
    const filter=new URLSearchParams({account_id:'eq.'+ACCOUNT,date:'eq.'+row.date,fetched_at:'lte.'+row.fetched_at});
    const r=await fetcher(base+'/rest/v1/ulhome_meta_daily_spend?'+filter,{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify(row),signal:AbortSignal.timeout(15000)});
    if(!r.ok)fail('META_SAVE_FAILED');
    const changed=await r.json(); if(!Array.isArray(changed))fail('META_SAVE_FAILED');
    if(changed.length){saved.push(row.date);continue;}
    // Atomic conflict-ignore prevents a slower cached run replacing a newer
    // snapshot, including when two syncs insert the first row simultaneously.
    const inserted=await fetcher(base+'/rest/v1/ulhome_meta_daily_spend?on_conflict=account_id,date',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(row),signal:AbortSignal.timeout(15000)});
    if(!inserted.ok)fail('META_SAVE_FAILED');
    const added=await inserted.json();if(!Array.isArray(added))fail('META_SAVE_FAILED');
    (added.length?saved:skipped).push(row.date);
  }
  return {ok:true,accountId:ACCOUNT,timezone:TARGET_TZ,savedDates:saved,keptNewerDates:skipped,sourceFetchedAt:rows.map(r=>r.fetched_at).sort()[0],partialDates:rows.filter(r=>r.source.endsWith('partial day')).map(r=>r.date)};
}
module.exports={ACCOUNT,SOURCE_TZ,TARGET_TZ,HOUR,zonedParts,shiftDate,payloadRows,aggregate,syncSpend};
