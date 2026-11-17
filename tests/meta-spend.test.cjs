const test=require('node:test'),assert=require('node:assert/strict');
const {aggregate,payloadRows,syncSpend,ACCOUNT,HOUR}=require('../api/_meta-spend.js');
const {createHandler}=require('../api/meta-spend-sync.js');
function sample(from,to,now){
 const hourly=[],daily=[];
 for(let date=from;date<=to;date=new Date(Date.parse(date+'T12:00Z')+86400000).toISOString().slice(0,10)){
  const base={date,account_id:ACCOUNT,account_currency:'USD',account_timezone:'America/Los_Angeles',data_fetched_at:now.toISOString(),spend:24};daily.push(base);
  for(let h=0;h<24;h++){const hh=String(h).padStart(2,'0');hourly.push({...base,spend:1,[HOUR]:hh+':00:00 - '+hh+':59:59'});}
 }
 return {hourly,daily};
}
test('Kyiv DST day contains 25 Pacific hourly buckets',()=>{
 const now=new Date('2026-10-28T14:00Z'),s=sample('2026-10-24','2026-10-26',now);
 const rows=aggregate(s.hourly,s.daily,{from:'2026-10-25',to:'2026-10-26',now});
 assert.equal(rows[0].spend_usd,25);assert.equal(rows[1].spend_usd,24);
 assert.match(rows[0].source,/complete day/);
});
test('Pacific repeated hour is not counted twice on the Kyiv day',()=>{
 const now=new Date('2026-11-04T14:00Z'),s=sample('2026-10-31','2026-11-02',now);
 const rows=aggregate(s.hourly,s.daily,{from:'2026-11-01',to:'2026-11-02',now});
 assert.equal(rows[0].spend_usd,23);assert.equal(rows[1].spend_usd,24);
});
test('rejects foreign accounts, currencies, timezone, bad spend and duplicate buckets',()=>{
 const now=new Date('2026-11-16T14:00Z'),s=sample('2026-11-14','2026-11-15',now),args={from:'2026-11-15',to:'2026-11-15',now};
 for(const field of [{account_id:'other'},{account_currency:'EUR'},{account_timezone:'UTC'},{spend:null},{spend:-1},{spend:true}])assert.throws(()=>aggregate([{...s.hourly[0],...field},...s.hourly.slice(1)],s.daily,args));
 assert.throws(()=>aggregate([...s.hourly,s.hourly[0]],s.daily,args),/DUPLICATE/);
 assert.throws(()=>aggregate(s.hourly.slice(1),s.daily,args),/MISMATCH/);
});
test('missing source days are not zero filled and incomplete responses fail closed',()=>{
 const now=new Date('2026-11-16T14:00Z'),s=sample('2026-11-15','2026-11-15',now);
 assert.throws(()=>aggregate(s.hourly,s.daily,{from:'2026-11-15',to:'2026-11-15',now}),/NO_VERIFIED/);
 for(const b of [{status:'pending',data:[]},{data:[],total_rows:1},{data:[],next:'cursor'},{error:'problem',data:[]}])assert.throws(()=>payloadRows(b));
 assert.deepEqual(payloadRows({data:[]}),[]);
});
test('explicit zero controls permit zero days',()=>{
 const now=new Date('2026-11-16T14:00Z'),s=sample('2026-11-14','2026-11-15',now);
 const rows=aggregate([],s.daily.map(r=>({...r,spend:0})),{from:'2026-11-15',to:'2026-11-15',now});assert.equal(rows[0].spend_usd,0);
});
function response(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body};}
test('sync scopes account and atomically keeps newer stored days',async()=>{
 const now=new Date('2026-11-16T14:00Z'),s=sample('2026-11-09','2026-11-15',now),calls=[];
 const result=await syncSpend({now,env:{WINDSOR_API_KEY:'test-only',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-db'},fetcher:async(url,options)=>{
  const u=new URL(url);calls.push({u,options});
  if(u.hostname==='connectors.windsor.ai'){assert.equal(u.searchParams.get('select_accounts'),ACCOUNT);assert.equal(options.redirect,'error');return response({data:u.searchParams.get('fields').includes(HOUR)?s.hourly:s.daily});}
  if(options.method==='PATCH'){assert.match(u.searchParams.get('fetched_at'),/^lte\./);return response([]);}
  assert.equal(options.method,'POST');assert.match(options.headers.Prefer,/ignore-duplicates/);return response([]);
 }});
 assert.deepEqual(result.savedDates,[]);assert.equal(result.keptNewerDates.length,6);assert(calls.length>2);
});
test('source failure produces no writes and does not leak provider error/key',async()=>{
 let writes=0;
 await assert.rejects(syncSpend({env:{WINDSOR_API_KEY:'test-only',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-db'},fetcher:async(url,o)=>{
  if(o.method!=='GET')writes++;throw Error('secret-url');
 }}),e=>e.code==='META_SOURCE_UNAVAILABLE'&&!e.message.includes('secret-url'));
 assert.equal(writes,0);
});
async function invoke(handler,method,authorization){const res={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}};await handler({method,headers:{authorization}},res);return res;}
test('endpoint requires cron secret or verified ULTERA admin',async()=>{
 let calls=0;const handler=createHandler({env:{CRON_SECRET:'a'.repeat(32)},sync:async()=>{calls++;return {savedDates:[],sourceFetchedAt:'2026-11-16T14:00:00Z'}}});
 assert.equal((await invoke(handler,'GET')).code,401);
 assert.equal((await invoke(handler,'GET','Bearer wrong')).code,401);
 assert.equal((await invoke(handler,'DELETE','Bearer '+'a'.repeat(32))).code,405);
 assert.equal((await invoke(handler,'POST','Bearer '+'a'.repeat(32))).code,503);
 assert.equal(calls,0);assert.equal((await invoke(handler,'GET','Bearer '+'a'.repeat(32))).code,200);assert.equal(calls,1);
 const admin=createHandler({env:{ULTERA_FINANCE_ENABLED:'1',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-db'},fetcher:async url=>response(String(url).includes('/auth/')?{id:'1',email:'qa@example.test',email_confirmed_at:'today'}:[]),sync:async()=>{throw Error('must not run')}});
 assert.equal((await invoke(admin,'POST','Bearer user')).code,403);
});
