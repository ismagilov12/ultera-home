-- Admin-only, read-only website funnel. Never uses Meta clicks or legacy analytics_events.
create index if not exists ulhome_journey_events_session_time_idx
  on public.ulhome_journey_events(session_id,occurred_at);

create or replace function public.ulhome_feed_link_stats_v2(
  p_from timestamptz default ((date_trunc('day', now() at time zone 'Europe/Kyiv') - interval '6 days') at time zone 'Europe/Kyiv'),
  p_to timestamptz default now()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if not public.ulhome_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from
     or p_to - p_from > interval '93 days' then
    raise exception 'invalid period: use a positive interval of at most 93 days' using errcode = '22023';
  end if;

  -- The CTE is also exercised with in-memory fixtures; no test orders are inserted.
  with
  seed_sessions as (
    select distinct session_id from public.ulhome_journey_events
    where occurred_at>=p_from and occurred_at<p_to
      and nullif(trim(session_id),'') is not null
  ),
  event_scope as materialized (
    -- Include the entire seeded session, not a guessed 30-minute lookback.
    -- This keeps long active sessions and earlier QA markers across date boundaries intact.
    select e.event_id,e.session_id,e.event_type,e.event_data,e.page_path,e.occurred_at,e.order_id
    from public.ulhome_journey_events e join seed_sessions s using(session_id)
    where e.occurred_at<p_to
  ),
  qa_sessions as (
    select distinct session_id from event_scope
    where lower(coalesce(event_data->>'is_test','')) = 'true'
       or lower(coalesce(event_data#>>'{first_touch,utm_source}','')) = 'qa'
       or lower(coalesce(event_data#>>'{last_touch,utm_source}','')) = 'qa'
       or lower(coalesce(event_data->>'utm_source','')) = 'qa'
       or lower(coalesce(page_path,'')) ~ '[?&]utm_source=qa([&#]|$)'
       or lower(coalesce(event_data#>>'{last_touch,path}','')) ~ '[?&]utm_source=qa([&#]|$)'
       or lower(coalesce(event_data#>>'{first_touch,path}','')) ~ '[?&]utm_source=qa([&#]|$)'
    union
    select o.session_id from public.ulhome_orders o
    where o.created_at>=p_from and o.created_at<p_to and nullif(trim(o.session_id),'') is not null
      and (lower(coalesce(o.landing_url,'')) ~ '[?&]utm_source=qa([&#]|$)'
           or coalesce(o.notes,'') ~* '(ТЕСТ ULTERA|TEST ULTERA|QA CHECKOUT|qa_[0-9]{8})'
           or lower(coalesce(o.status,''))='test')
  ),
  clean_events as materialized (
    select e.* from event_scope e
    where not exists (select 1 from qa_sessions q where q.session_id=e.session_id)
  ),
  page_context as (
    select e.*,
      coalesce(nullif(event_data#>>'{last_touch,utm_source}',''),
               nullif(event_data#>>'{first_touch,utm_source}','')) as utm_source,
      coalesce(nullif(event_data#>>'{last_touch,referrer_origin}',''),
               nullif(event_data->>'referrer_origin',''),
               nullif(event_data#>>'{first_touch,referrer_origin}','')) as referrer,
      replace(lower(coalesce(substring(coalesce(page_path,'') from '[?&]p=([^&#]+)'),
        substring(coalesce(event_data#>>'{last_touch,path}','') from '[?&]p=([^&#]+)'),
        '')), '%2c', ',') as product_token
    from clean_events e where event_type='page_view'
  ),
  landing_entries as (
    select session_id, event_id, occurred_at,
      case when position(',' in product_token)>0 then split_part(product_token,',',2)
           else product_token end as uid,
      true as direct_link
    from page_context where product_token<>''
  ),
  product_entries as (
    select session_id, event_id, occurred_at,
           lower(trim(event_data->>'uid')) as uid, false as direct_link
    from clean_events where event_type in ('product_view','color_view')
      and nullif(trim(event_data->>'uid'),'') is not null
  ),
  first_entries as (
    -- One acquisition model per session, not one copy of an order per viewed model.
    select distinct on(session_id) session_id, uid, occurred_at as entered_at, direct_link
    from (select * from landing_entries union all select * from product_entries) e
    where nullif(trim(uid),'') is not null
    order by session_id, occurred_at, direct_link desc, event_id
  ),
  cohorts as materialized (
    select * from first_entries where entered_at>=p_from
  ),
  sources as (
    select distinct on(p.session_id) p.session_id,
      case
        when lower(p.utm_source) in ('fb','facebook','meta') then 'Meta'
        when lower(p.utm_source) in ('ig','instagram') then 'Instagram'
        when lower(p.utm_source)='google' then 'Google'
        when p.utm_source is not null then left(p.utm_source,24)
        when lower(coalesce(p.referrer,'')) like '%instagram.%' then 'Instagram'
        when lower(coalesce(p.referrer,'')) like '%facebook.%' then 'Meta'
        when lower(coalesce(p.referrer,'')) like '%google.%' then 'Google'
        else 'Direct / невідомо'
      end as source
    from page_context p join cohorts c using(session_id)
    order by p.session_id, abs(extract(epoch from (p.occurred_at-c.entered_at))), p.occurred_at
  ),
  carts as (
    -- Any later cart in the acquisition session. SKU contents are reported separately.
    select c.session_id, min(e.occurred_at) as cart_at
    from cohorts c join clean_events e on e.session_id=c.session_id
      and e.event_type='add_to_cart' and e.occurred_at>=c.entered_at
    group by c.session_id
  ),
  order_scope as materialized (
    select id, session_id, created_at, items, total, status, landing_url,
           keycrm_status_id, keycrm_status_group, keycrm_synced_at
    from public.ulhome_orders
    where created_at>=p_from and created_at<p_to
      and lower(coalesce(status,'')) not in ('lead','draft','test')
      and coalesce(keycrm_status_id,0)<>99
      and lower(coalesce(keycrm_status_group,''))<>'excluded'
      and lower(coalesce(landing_url,'')) !~ '[?&]utm_source=qa([&#]|$)'
      and coalesce(notes,'') !~* '(ТЕСТ ULTERA|TEST ULTERA|QA CHECKOUT|qa_[0-9]{8})'
      and not exists (select 1 from qa_sessions q where q.session_id=ulhome_orders.session_id)
  ),
  orders as materialized (
    select o.*,
      case
        when lower(coalesce(o.status,'')) in ('cancelled','canceled','rejected','refused','refund')
          or lower(coalesce(o.keycrm_status_group,''))='rejected' then 'rejected'
        when lower(coalesce(o.keycrm_status_group,''))='approved'
          and coalesce(o.keycrm_status_id,0)<>1 then 'approved'
        when lower(coalesce(o.keycrm_status_group,''))='pending'
          or o.keycrm_status_id=1 then 'pending'
        else 'unknown'
      end as crm_group
    from order_scope o
  ),
  order_event_sessions as (
    select o.id,e.session_id,min(case when e.event_type='order_saved' then 1 else 2 end) as priority
    from orders o join clean_events e on e.order_id=o.id
      and e.event_type in ('order_saved','checkout_submit_acknowledged')
    group by o.id,e.session_id
  ),
  order_session_links as (
    select id as order_id,session_id,0 as priority from orders
    where nullif(trim(session_id),'') is not null
    union all
    select es.id,es.session_id,es.priority from order_event_sessions es join orders o on o.id=es.id
    where es.session_id is distinct from o.session_id
  ),
  order_candidates as (
    select o.id as order_id, c.session_id, c.uid, c.entered_at, ca.cart_at,
           o.created_at, o.total, o.crm_group,
           l.priority
    from order_session_links l join orders o on o.id=l.order_id
    join cohorts c on c.session_id=l.session_id and o.created_at>=c.entered_at
    left join carts ca on ca.session_id=c.session_id
  ),
  attributed_orders as materialized (
    select distinct on(order_id) * from order_candidates
    order by order_id, priority, entered_at, session_id
  ),
  funnel_orders as materialized (
    select * from attributed_orders where cart_at is not null and created_at>=cart_at
  ),
  converted as (
    select distinct session_id from funnel_orders
  ),
  funnel_sessions as (
    select c.uid, count(*)::integer as entry_sessions,
      count(*) filter(where c.direct_link)::integer as direct_link_sessions,
      count(*) filter(where ca.cart_at is not null)::integer as cart_sessions,
      count(*) filter(where cv.session_id is not null)::integer as converted_sessions,
      max(c.entered_at) as last_entry
    from cohorts c left join carts ca using(session_id) left join converted cv using(session_id) group by c.uid
  ),
  funnel_sales as (
    select uid, count(*)::integer as matched_orders,
      coalesce(sum(total),0)::numeric as matched_revenue,
      count(*) filter(where crm_group='approved')::integer as matched_approved_orders
    from funnel_orders group by uid
  ),
  views as (
    select lower(trim(event_data->>'uid')) as uid, count(*)::integer as views,
      count(distinct session_id)::integer as view_sessions
    from clean_events where event_type in ('product_view','color_view')
      and occurred_at>=p_from and nullif(trim(event_data->>'uid'),'') is not null
    group by lower(trim(event_data->>'uid'))
  ),
  source_counts as (
    select c.uid, coalesce(s.source,'Direct / невідомо') as source, count(*) as sessions
    from cohorts c left join sources s using(session_id) group by 1,2
  ),
  top_sources as (
    select distinct on(uid) uid,source from source_counts order by uid,sessions desc,source
  ),
  raw_items as (
    select o.id, o.total, o.crm_group,
      nullif(lower(trim(i.item->>'uid')),'') as uid,
      case when coalesce(i.item->>'qty','') ~ '^[0-9]+([.][0-9]+)?$'
        then greatest((i.item->>'qty')::numeric,0) else 1::numeric end as qty,
      case when coalesce(i.item->>'price','') ~ '^[0-9]+([.][0-9]+)?$'
        then (i.item->>'price')::numeric else 0::numeric end as price
    from orders o cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end
    ) as i(item)
  ),
  priced_items as (
    select *, sum(qty*price) over(partition by id) as gross_total from raw_items
  ),
  item_lines as (
    select *, case when gross_total>0 then coalesce(total,0)*qty*price/gross_total
                        else 0::numeric end as revenue from priced_items
  ),
  item_sales as (
    select uid, count(distinct id)::integer as item_orders, sum(qty) as item_qty,
      sum(revenue) as item_revenue,
      coalesce(sum(qty) filter(where crm_group='approved'),0) as approved_qty,
      coalesce(sum(revenue) filter(where crm_group='approved'),0) as approved_revenue,
      coalesce(sum(qty) filter(where crm_group='pending'),0) as pending_qty,
      coalesce(sum(qty) filter(where crm_group='rejected'),0) as rejected_qty,
      coalesce(sum(qty) filter(where crm_group='unknown'),0) as unknown_qty
    from item_lines where uid is not null group by uid
  ),
  all_keys as (
    select uid from funnel_sessions union select uid from views union select uid from item_sales
  ),
  catalog as (
    select distinct on(uid) uid,title,family from public.ulhome_products
    order by uid,published desc,updated_at desc nulls last,id
  ),
  result_rows as (
    select k.uid, coalesce(f.entry_sessions,0) as entry_sessions,
      coalesce(f.direct_link_sessions,0) as direct_link_sessions,
      coalesce(v.views,0) as views,coalesce(v.view_sessions,0) as view_sessions,
      coalesce(f.cart_sessions,0) as cart_sessions,coalesce(f.converted_sessions,0) as converted_sessions,
      coalesce(s.matched_orders,0) as matched_orders,coalesce(s.matched_revenue,0) as matched_revenue,
      coalesce(s.matched_approved_orders,0) as matched_approved_orders,
      coalesce(i.item_orders,0) as item_orders,coalesce(i.item_qty,0) as item_qty,
      coalesce(i.item_revenue,0) as item_revenue,coalesce(i.approved_qty,0) as approved_qty,
      coalesce(i.approved_revenue,0) as approved_revenue,coalesce(i.pending_qty,0) as pending_qty,
      coalesce(i.rejected_qty,0) as rejected_qty,coalesce(i.unknown_qty,0) as unknown_qty,
      coalesce(t.source,'') as top_source,f.last_entry,
      coalesce(p.title,k.uid) as catalog_title,coalesce(p.family,'') as catalog_family
    from all_keys k left join funnel_sessions f using(uid) left join views v using(uid)
    left join funnel_sales s using(uid) left join item_sales i using(uid)
    left join top_sources t using(uid) left join catalog p on p.uid=k.uid
  ),
  site_summary as (
    select count(*)::integer as site_orders,coalesce(sum(total),0) as site_revenue,
      count(*) filter(where crm_group='approved')::integer as site_approved,
      count(*) filter(where crm_group='pending')::integer as site_pending,
      count(*) filter(where crm_group='rejected')::integer as site_rejected,
      count(*) filter(where crm_group='unknown')::integer as site_unknown,
      count(*) filter(where keycrm_synced_at is null or keycrm_synced_at<now()-interval '24 hours')::integer as stale_crm_orders,
      min(keycrm_synced_at) as crm_oldest_sync,max(keycrm_synced_at) as crm_latest_sync
    from orders
  )
  select jsonb_build_object(
    'version',2,'generated_at',now(),'from',p_from,'to',p_to,'timezone','Europe/Kyiv',
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.entry_sessions desc,r.uid) from result_rows r),'[]'::jsonb),
    'summary',(select to_jsonb(s) from site_summary s)||jsonb_build_object(
      'tracked_orders',(select count(*) from funnel_orders),
      'orders_with_entry',(select count(*) from attributed_orders),
      'orders_without_cart',(select count(*) from attributed_orders a where not exists(select 1 from funnel_orders f where f.order_id=a.order_id)),
      'orders_without_entry',(select count(*) from orders o where not exists(select 1 from attributed_orders a where a.order_id=o.id)),
      'qa_sessions_excluded',(select count(*) from qa_sessions),
      'items_missing_uid',coalesce((select sum(qty) from item_lines where uid is null),0),
      'missing_uid_revenue',coalesce((select sum(revenue) from item_lines where uid is null),0),
      'unallocated_item_revenue',coalesce((select sum(o.total) from orders o where not exists(select 1 from priced_items i where i.id=o.id and i.gross_total>0)),0)
    )
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.ulhome_feed_link_stats_v2(timestamptz,timestamptz) from public,anon;
grant execute on function public.ulhome_feed_link_stats_v2(timestamptz,timestamptz) to authenticated,service_role;
comment on function public.ulhome_feed_link_stats_v2(timestamptz,timestamptz)
is 'Admin-only website session funnel from current journey events, ordered entry/cart/saved order, separate authoritative SKU sales and cached CRM approvals. Not Meta Ads clicks.';

notify pgrst, 'reload schema';
