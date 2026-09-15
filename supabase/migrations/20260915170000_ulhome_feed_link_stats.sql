create or replace function public.ulhome_feed_link_stats(
  p_from timestamptz default (now() - interval '7 days'),
  p_to timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.ulhome_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with
  event_scope as (
    select
      e.session_id,
      e.event_type,
      e.event_data,
      e.page_url,
      e.referrer,
      e.created_at
    from public.analytics_events e
    where e.created_at >= p_from
      and e.created_at < p_to
      and e.event_type in ('page_view', 'product_view', 'color_view', 'click')
  ),
  url_events_raw as (
    select
      e.*,
      replace(
        coalesce(substring(lower(e.page_url) from '[?&]p=([^&#]+)'), ''),
        '%2c',
        ','
      ) as product_token,
      nullif(substring(lower(e.page_url) from '[?&]utm_source=([^&#]+)'), '') as utm_source
    from event_scope e
    where e.page_url ~* '[?&]p='
  ),
  url_events as (
    select
      r.*,
      case
        when position(',' in r.product_token) > 0 then split_part(r.product_token, ',', 2)
        else r.product_token
      end as uid,
      case
        when r.utm_source in ('ig', 'instagram') then 'IG'
        when r.utm_source in ('fb', 'facebook') then 'FB'
        when r.utm_source = 'google' then 'Google'
        when r.utm_source is not null then left(r.utm_source, 24)
        when lower(coalesce(r.referrer, '')) like '%instagram.%' then 'IG'
        when lower(coalesce(r.referrer, '')) like '%facebook.%' then 'FB'
        when lower(coalesce(r.referrer, '')) like '%google.%' then 'Google'
        when lower(coalesce(r.page_url, '')) like '%fbclid=%' then 'Meta'
        else 'Direct'
      end as source
    from url_events_raw r
    where r.product_token <> ''
  ),
  feed_pageviews as (
    select *
    from url_events
    where event_type = 'page_view' and uid <> ''
  ),
  feed_clicks as (
    select
      uid,
      count(distinct session_id)::integer as clicks,
      count(*)::integer as hits,
      max(created_at) as last_click
    from feed_pageviews
    group by uid
  ),
  source_counts as (
    select uid, source, count(distinct session_id)::integer as sessions
    from feed_pageviews
    group by uid, source
  ),
  top_sources as (
    select distinct on (uid) uid, source as top_source
    from source_counts
    order by uid, sessions desc, source
  ),
  feed_sessions as (
    select distinct on (session_id)
      session_id,
      uid,
      source
    from feed_pageviews
    order by session_id, created_at
  ),
  product_views as (
    select
      lower(e.event_data ->> 'uid') as uid,
      count(distinct e.session_id)::integer as views
    from event_scope e
    where e.event_type in ('product_view', 'color_view')
      and coalesce(e.event_data ->> 'uid', '') <> ''
    group by lower(e.event_data ->> 'uid')
  ),
  add_to_carts as (
    select
      e.uid,
      count(distinct e.session_id)::integer as atc
    from url_events e
    where e.event_type = 'click'
      and e.event_data ->> 'id' = 'm_buy'
      and e.uid <> ''
    group by e.uid
  ),
  valid_orders as (
    select o.*
    from public.ulhome_orders o
    where o.created_at >= p_from
      and o.created_at < p_to
      and lower(coalesce(o.status, '')) not in ('lead', 'cancelled', 'canceled', 'rejected', 'refused', 'refund')
      and lower(coalesce(o.keycrm_status_group, '')) <> 'rejected'
  ),
  order_tokens_raw as (
    select
      o.*,
      replace(
        coalesce(substring(lower(o.landing_url) from '[?&]p=([^&#]+)'), ''),
        '%2c',
        ','
      ) as product_token,
      nullif(substring(lower(o.landing_url) from '[?&]utm_source=([^&#]+)'), '') as utm_source
    from valid_orders o
  ),
  order_tokens as (
    select
      o.*,
      case
        when position(',' in o.product_token) > 0 then split_part(o.product_token, ',', 2)
        else nullif(o.product_token, '')
      end as direct_uid,
      case
        when o.utm_source in ('ig', 'instagram') then 'IG'
        when o.utm_source in ('fb', 'facebook') then 'FB'
        when o.utm_source = 'google' then 'Google'
        when o.utm_source is not null then left(o.utm_source, 24)
        when lower(coalesce(o.referrer, '')) like '%instagram.%' then 'IG'
        when lower(coalesce(o.referrer, '')) like '%facebook.%' then 'FB'
        when lower(coalesce(o.referrer, '')) like '%google.%' then 'Google'
        when lower(coalesce(o.landing_url, '')) like '%fbclid=%' then 'Meta'
        else null
      end as direct_source
    from order_tokens_raw o
  ),
  attributed_orders as (
    select
      o.id,
      coalesce(o.direct_uid, s.uid) as uid,
      coalesce(o.direct_source, s.source, 'Direct') as source,
      coalesce(o.total, 0)::numeric as total
    from order_tokens o
    left join feed_sessions s on s.session_id = o.session_id
    where coalesce(o.direct_uid, s.uid) is not null
  ),
  link_orders as (
    select
      uid,
      count(*)::integer as link_orders,
      sum(total)::numeric as link_revenue
    from attributed_orders
    group by uid
  ),
  item_sales as (
    select
      lower(i.item ->> 'uid') as uid,
      count(distinct o.id)::integer as item_orders,
      sum(coalesce(nullif(i.item ->> 'qty', '')::numeric, 1))::integer as item_qty,
      sum(
        coalesce(nullif(i.item ->> 'price', '')::numeric, 0)
        * coalesce(nullif(i.item ->> 'qty', '')::numeric, 1)
      )::numeric as item_revenue
    from valid_orders o
    cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as i(item)
    where coalesce(i.item ->> 'uid', '') <> ''
    group by lower(i.item ->> 'uid')
  ),
  all_keys as (
    select uid from feed_clicks
    union select uid from product_views
    union select uid from add_to_carts
    union select uid from link_orders
    union select uid from item_sales
  )
  select jsonb_build_object(
    'rows', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'uid', k.uid,
          'clicks', coalesce(c.clicks, 0),
          'hits', coalesce(c.hits, 0),
          'views', coalesce(v.views, 0),
          'atc', coalesce(a.atc, 0),
          'link_orders', coalesce(lo.link_orders, 0),
          'link_revenue', coalesce(lo.link_revenue, 0),
          'item_orders', coalesce(i.item_orders, 0),
          'item_qty', coalesce(i.item_qty, 0),
          'item_revenue', coalesce(i.item_revenue, 0),
          'top_source', coalesce(s.top_source, ''),
          'last_click', c.last_click
        )
        order by coalesce(c.clicks, 0) desc, k.uid
      ),
      '[]'::jsonb
    )
  ) into v_result
  from all_keys k
  left join feed_clicks c on c.uid = k.uid
  left join product_views v on v.uid = k.uid
  left join add_to_carts a on a.uid = k.uid
  left join link_orders lo on lo.uid = k.uid
  left join item_sales i on i.uid = k.uid
  left join top_sources s on s.uid = k.uid;

  return coalesce(v_result, jsonb_build_object('rows', '[]'::jsonb));
end;
$$;

revoke all on function public.ulhome_feed_link_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.ulhome_feed_link_stats(timestamptz, timestamptz) to authenticated, service_role;

comment on function public.ulhome_feed_link_stats(timestamptz, timestamptz)
is 'Admin-only product-feed performance: link visits, product engagement, attributed orders, and SKU sales.';
