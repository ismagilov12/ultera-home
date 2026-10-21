-- Private compatibility layer: historical analytics + new consented events.
-- Existing RPCs and the publicly readable legacy table remain unchanged.
begin;
create view public.ulhome_behavior_events with (security_invoker=true) as
select session_id,event_type,event_data,page_url,referrer,device_type,created_at from public.analytics_events
union all
select j.session_id,j.event_type,
       j.event_data || jsonb_strip_nulls(jsonb_build_object('category','footwear','family',p.family,'title',p.title,'color_name',p.color_name,'color_hex',p.color_hex)),
       'https://ultera.in.ua'||j.page_path,
       j.event_data->>'referrer_origin',j.event_data->>'device',j.occurred_at
from public.ulhome_journey_events j
left join public.ulhome_products p on p.uid=j.event_data->>'uid'
where coalesce(j.event_data->>'is_test','false') <> 'true';
revoke all on public.ulhome_behavior_events from public,anon;
grant select on public.ulhome_behavior_events to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ulhome_analytics_summary_v2(since_iso timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.ulhome_is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  WITH pv AS (
    SELECT session_id, page_url, referrer, device_type, created_at
    FROM public.ulhome_behavior_events
    WHERE event_type = 'page_view'
      AND (since_iso IS NULL OR created_at >= since_iso)
  ),
  evt AS (
    -- Only the event types the admin funnel actually displays.
    -- Counting every type (mouse_move/click/scroll/...) scanned 160k+ rows
    -- and blew past the 8s statement_timeout, which silently zeroed out
    -- the whole summary (incl. daily "Переходи"). Whitelist keeps it fast.
    SELECT event_type, count(*)::bigint AS cnt
    FROM public.ulhome_behavior_events
    WHERE (since_iso IS NULL OR created_at >= since_iso)
      AND event_type IN ('page_view','section_view','click','funnel_step','add_to_cart','checkout_started','order_saved')
    GROUP BY event_type
  ),
  daily AS (
    SELECT
      to_char((created_at AT TIME ZONE 'Europe/Kyiv')::date, 'YYYY-MM-DD') AS day,
      count(DISTINCT session_id)::bigint AS unique_sessions,
      count(*)::bigint                    AS page_views
    FROM pv
    GROUP BY 1
  ),
  top_pages AS (
    SELECT COALESCE(
      NULLIF(regexp_replace(page_url, '^https?://[^/]+', ''), ''),
      '/'
    ) AS path, count(DISTINCT session_id)::bigint AS cnt
    FROM pv
    GROUP BY 1
    ORDER BY cnt DESC
    LIMIT 30
  ),
  refs AS (
    SELECT
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN '(direct)'
        ELSE lower(regexp_replace(regexp_replace(referrer, '^https?://', ''), '/.*$', ''))
      END AS ref_host,
      count(DISTINCT session_id)::bigint AS cnt
    FROM pv
    GROUP BY 1
    ORDER BY cnt DESC
    LIMIT 30
  ),
  devs AS (
    SELECT COALESCE(NULLIF(device_type,''), 'Other') AS device, count(DISTINCT session_id)::bigint AS cnt
    FROM pv
    GROUP BY 1
  ),
  -- KeyCRM апрув-метрики по замовленнях у періоді
  ord AS (
    SELECT
      keycrm_status_group AS grp,
      COALESCE(keycrm_status_name, status, '—') AS label,
      total::numeric AS total
    FROM public.ulhome_orders
    WHERE (since_iso IS NULL OR created_at >= since_iso)
  ),
  ord_kpi AS (
    SELECT
      count(*) FILTER (WHERE grp='approved')::bigint AS approved_orders,
      count(*) FILTER (WHERE grp='rejected')::bigint AS rejected_orders,
      count(*) FILTER (WHERE grp='pending')::bigint  AS pending_orders,
      count(*) FILTER (WHERE grp='excluded')::bigint AS excluded_orders,
      count(*) FILTER (WHERE grp IS NULL)::bigint    AS unsynced_orders,
      count(*)::bigint                                AS total_orders,
      sum(total) FILTER (WHERE grp='approved')::numeric AS approved_revenue
    FROM ord
  ),
  -- breakdown по конкретних статусах для majbutn'ого донат-чарту
  status_breakdown AS (
    SELECT label, grp, count(*)::bigint AS cnt
    FROM ord
    WHERE grp IS NOT NULL
    GROUP BY label, grp
    ORDER BY cnt DESC
  ),
  kpi AS (
    SELECT
      (SELECT count(DISTINCT session_id) FROM pv)::bigint AS unique_sessions,
      (SELECT count(*) FROM pv)::bigint AS page_views,
      (SELECT approved_orders FROM ord_kpi) AS approved_orders,
      (SELECT rejected_orders FROM ord_kpi) AS rejected_orders,
      (SELECT pending_orders  FROM ord_kpi) AS pending_orders,
      (SELECT excluded_orders FROM ord_kpi) AS excluded_orders,
      (SELECT unsynced_orders FROM ord_kpi) AS unsynced_orders,
      (SELECT total_orders    FROM ord_kpi) AS total_orders,
      (SELECT approved_revenue FROM ord_kpi) AS approved_revenue,
      -- approval_rate = approved / (approved + rejected); NULL якщо денумерат 0
      CASE
        WHEN ((SELECT approved_orders + rejected_orders FROM ord_kpi)) > 0
        THEN round(((SELECT approved_orders FROM ord_kpi)::numeric * 100)
                   / NULLIF((SELECT approved_orders + rejected_orders FROM ord_kpi),0), 2)
        ELSE NULL
      END AS approval_rate
  )
  SELECT jsonb_build_object(
    'daily',            COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day DESC) FROM daily d),     '[]'::jsonb),
    'top_pages',        COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM top_pages t),                     '[]'::jsonb),
    'referrers',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM refs r),                          '[]'::jsonb),
    'devices',          COALESCE((SELECT jsonb_agg(to_jsonb(dv)) FROM devs dv),                        '[]'::jsonb),
    'evt_counts',       COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM evt e),                           '[]'::jsonb),
    'kpi',              COALESCE((SELECT to_jsonb(k) FROM kpi k),                                      '{}'::jsonb),
    'status_breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(sb)) FROM status_breakdown sb),            '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$
;
revoke all on function public.ulhome_analytics_summary_v2(timestamptz) from public,anon;
grant execute on function public.ulhome_analytics_summary_v2(timestamptz) to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ulhome_product_views_summary_v2(p_days integer DEFAULT 1, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
  v_days int := greatest(coalesce(p_days, 1), 1);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_rows jsonb;
  v_totals jsonb;
begin
  -- admin only
  if not public.ulhome_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with raw as (
    select
      coalesce(
        nullif(trim(coalesce(event_data->>'family', event_data->>'group')), ''),
        nullif(trim(event_data->>'title'), ''),
        '—'
      ) as model,
      coalesce(nullif(trim(event_data->>'color_name'), ''), '—') as color,
      nullif(trim(event_data->>'color_hex'), '') as color_hex,
      event_data->>'uid' as uid,
      session_id,
      event_type,
      created_at
    FROM public.ulhome_behavior_events
    where event_type in ('product_view', 'color_view')
      and created_at >= v_since
      and (p_category is null or event_data->>'category' = p_category)
  ),
  agg as (
    select
      model,
      color,
      max(color_hex) as color_hex,
      count(*) filter (where event_type = 'product_view')        as views,
      count(*) filter (where event_type = 'color_view')          as color_switches,
      count(distinct session_id)                                  as unique_sessions,
      max(created_at)                                             as last_seen
    from raw
    group by model, color
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'model',           model,
        'color',           color,
        'color_hex',       color_hex,
        'views',           views,
        'color_switches',  color_switches,
        'total',           views + color_switches,
        'unique_sessions', unique_sessions,
        'last_seen',       last_seen
      )
      order by (views + color_switches) desc, unique_sessions desc, model, color
    ), '[]'::jsonb)
  into v_rows
  from agg;

  select jsonb_build_object(
    'views',           coalesce(sum((r->>'views')::int), 0),
    'color_switches',  coalesce(sum((r->>'color_switches')::int), 0),
    'unique_sessions', coalesce(sum((r->>'unique_sessions')::int), 0),
    'models',          count(distinct r->>'model')
  )
  into v_totals
  from jsonb_array_elements(v_rows) r;

  return jsonb_build_object(
    'since',    v_since,
    'days',     v_days,
    'category', p_category,
    'totals',   v_totals,
    'rows',     v_rows
  );
end;
$function$
;
revoke all on function public.ulhome_product_views_summary_v2(integer,text) from public,anon;
grant execute on function public.ulhome_product_views_summary_v2(integer,text) to authenticated,service_role;
commit;
