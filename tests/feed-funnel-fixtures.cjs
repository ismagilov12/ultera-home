'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const events=[],orders=[];
let sequence=0;
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const time=hm=>'2026-11-01T'+hm+':00Z';
function event(session,type,hm,uid,extra={}) {
  const row={event_id:uuid(++sequence),session_id:session,event_type:type,
    event_data:uid?{uid}:{},page_path:'/',occurred_at:hm.includes('T')?hm:time(hm),order_id:null,...extra};
  events.push(row);return row;
}
function entry(session,uid,hm='01:00'){event(session,'product_view',hm,uid);}
function cart(session,uid,hm='01:02'){event(session,'add_to_cart',hm,uid);}
function order(session,items,total,extra={}){
  const row={id:uuid(100+orders.length),session_id:session,created_at:time('01:05'),items,total,status:'new',
    landing_url:'https://ultera.in.ua/',notes:'',keycrm_status_id:23,keycrm_status_group:'approved',
    keycrm_synced_at:time('11:00'),...extra};orders.push(row);return row;
}
const item=(uid,price=500,qty=1)=>({uid,price,qty});
entry('normal','A');event('normal','color_view','01:01','B');cart('normal','B');
order('normal',[item('B',500,2),item('insole',100)],990);
order('normal',[item('A',600)],600,{created_at:time('01:06'),keycrm_status_id:1,keycrm_status_group:'pending'});
entry('refusal','A');cart('refusal','A');order('refusal',[item('A')],500,{keycrm_status_id:15,keycrm_status_group:'rejected'});
entry('late-cart','B');order('late-cart',[item('B',300)],300);cart('late-cart','B','01:10');
order('untracked',[item('untracked')],500);
event('qa-last-touch','page_view','2026-10-31T10:00:00Z',null,{event_data:{first_touch:{},last_touch:{utm_source:'qa'}}});
entry('qa-last-touch','QA');cart('qa-last-touch','QA');order('qa-last-touch',[item('QA')],500);
entry('carry','carry','2026-10-31T20:00:00Z');cart('carry','carry');order('carry',[item('carry')],500);
entry('lead','lead');cart('lead','lead');order('lead',[item('lead')],500,{status:'lead'});
cart('reverse','reverse','01:00');entry('reverse','reverse','01:02');order('reverse',[item('reverse')],500);
entry('fallback','fallback');cart('fallback','fallback');
const fallback=order(null,[item('fallback')],500);
event('fallback','order_saved','01:05',null,{order_id:fallback.id});
entry('test-notes','QA-NOTES');cart('test-notes','QA-NOTES');order('test-notes',[item('QA-NOTES')],500,{notes:'ТЕСТ ULTERA — НЕ ОБРОБЛЯТИ'});
entry('excluded','excluded');cart('excluded','excluded');order('excluded',[item('excluded')],500,{keycrm_status_id:99,keycrm_status_group:'excluded'});
entry('missing-price','missing-price');cart('missing-price','missing-price');order('missing-price',[item('missing-price',0)],200);
entry('missing-uid','missing-uid');cart('missing-uid','missing-uid');order('missing-uid',[{price:100,qty:1}],100);
entry('unknown','unknown');cart('unknown','unknown');order('unknown',[item('unknown')],500,{keycrm_status_id:333,keycrm_status_group:null});
entry('authoritative','authoritative');cart('authoritative','authoritative');
const linked=order('authoritative',[item('authoritative')],500);
entry('duplicate-event','duplicate-event');cart('duplicate-event','duplicate-event');
event('duplicate-event','order_saved','01:05',null,{order_id:linked.id});
event('qa-flag','product_view','01:00','QA-FLAG',{event_data:{uid:'QA-FLAG',is_test:true}});
cart('qa-flag','QA-FLAG');order('qa-flag',[item('QA-FLAG')],500);
entry('future','future','12:01');cart('future','future','12:02');order('future',[item('future')],500,{created_at:time('12:03')});

const products=['A','B','insole','untracked','carry','lead','reverse','fallback','excluded','missing-price',
  'missing-uid','unknown','authoritative','duplicate-event'].map(uid=>({uid:uid.toLowerCase(),title:uid,family:'Fixture'}));

function recordset(data,columns){return 'select * from jsonb_to_recordset($fixture$'+JSON.stringify(data)+'$fixture$::jsonb) as x('+columns+')';}
function buildQuery(empty=false) {
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/sql/feed_link_stats_v2.sql'),'utf8');
  let core=sql.slice(sql.indexOf('  with\n'),sql.indexOf(' into v_result;'));
  assert.ok(core.startsWith('  with\n'));
  core=core.replaceAll('public.ulhome_journey_events','fixture_events')
    .replaceAll('public.ulhome_orders','fixture_orders').replaceAll('ulhome_orders.session_id','fixture_orders.session_id')
    .replaceAll('public.ulhome_products','fixture_products')
    .replace(/\bp_from\b/g,"timestamptz '2026-11-01T00:00:00Z'")
    .replace(/\bp_to\b/g,"timestamptz '2026-11-01T12:00:00Z'");
  const e=recordset(empty?[]:events,'event_id uuid,session_id text,event_type text,event_data jsonb,page_path text,occurred_at timestamptz,order_id uuid');
  const o=recordset(empty?[]:orders,'id uuid,session_id text,created_at timestamptz,items jsonb,total numeric,status text,landing_url text,notes text,keycrm_status_id int,keycrm_status_group text,keycrm_synced_at timestamptz');
  const p=recordset(products,'uid text,title text,family text,published boolean,updated_at timestamptz,id uuid');
  return 'with fixture_events as ('+e+'),fixture_orders as ('+o+'),fixture_products as ('+p+'),'+core.replace(/^  with\n/,'')+';';
}
function check(result,empty=false) {
  assert.equal(result.version,2);
  if(empty){assert.deepEqual(result.rows,[]);assert.equal(result.summary.site_orders,0);return;}
  const row=uid=>result.rows.find(r=>r.uid===uid);
  assert.equal(row('a').entry_sessions,2);
  assert.equal(row('a').converted_sessions,2);
  assert.equal(row('a').matched_orders,3);
  assert.equal(row('a').matched_approved_orders,1);
  assert.equal(row('a').item_qty,2);
  assert.equal(row('b').converted_sessions,0);
  assert.equal(row('b').item_qty,3);
  assert.equal(row('b').item_revenue,1200);
  assert.equal(row('insole').item_revenue,90);
  assert.equal(row('carry').entry_sessions,0);
  assert.equal(row('untracked').entry_sessions,0);
  assert.equal(row('reverse').cart_sessions,0);
  assert.equal(row('fallback').matched_orders,1);
  assert.equal(row('duplicate-event').matched_orders,0);
  assert.equal(row('authoritative').matched_orders,1);
  assert.equal(row('unknown').unknown_qty,1);
  assert.equal(row('qa'),undefined);
  assert.equal(row('qa-notes'),undefined);
  assert.equal(row('qa-flag'),undefined);
  assert.equal(row('future'),undefined);
  assert.equal(result.summary.items_missing_uid,1);
  assert.equal(result.summary.missing_uid_revenue,100);
  assert.equal(result.summary.unallocated_item_revenue,200);
  assert.equal(result.summary.orders_without_cart,2);
  assert.equal(result.summary.orders_without_entry,2);
  assert.equal(result.summary.site_orders,12);
  assert.equal(result.summary.tracked_orders,8);
  assert.equal(result.summary.qa_sessions_excluded,3);
  assert.equal(result.rows.reduce((n,r)=>n+r.matched_orders,0),result.summary.tracked_orders);
  for(const r of result.rows) assert.ok(r.converted_sessions<=r.cart_sessions&&r.cart_sessions<=r.entry_sessions);
}
module.exports={buildQuery,check};
if(require.main===module){
  if(process.argv[2]==='--query')process.stdout.write(buildQuery(process.argv.includes('--empty')));
  else if(process.argv[2]==='--assert-json'){
    check(JSON.parse(process.argv[3]),process.argv.includes('--empty'));
    console.log('SQL funnel fixtures passed');
  }
}
