-- Single filtered page-view scan; mouse-move/click history is not scanned.
-- Invoker security and the same admin authorization remain enabled.
begin;
CREATE OR REPLACE FUNCTION public.ulhome_analytics_summary_v2(since_iso timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
  since_from timestamptz := coalesce(since_iso,'-infinity'::timestamptz);
BEGIN
  IF NOT public.ulhome_is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  WITH pv AS MATERIALIZED (
    SELECT session_id,page_url,referrer,device_type,created_at
    FROM public.analytics_events
    WHERE event_type='page_view' AND created_at>=since_from
    UNION ALL
    SELECT session_id,'https://ultera.in.ua'||page_path,
           event_data->>'referrer_origin',event_data->>'device',occurred_at
    FROM public.ulhome_journey_events
    WHERE event_type='page_view' AND occurred_at>=since_from
      AND coalesce(event_data->>'is_test','false')<>'true'
  ),
  evt AS (
    SELECT 'page_view'::text event_type,count(*)::bigint cnt FROM pv
    UNION ALL
    SELECT event_type,count(*)::bigint cnt FROM public.ulhome_journey_events
    WHERE event_type IN ('add_to_cart','checkout_started','order_saved')
      AND occurred_at>=since_from AND coalesce(event_data->>'is_test','false')<>'true'
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
    WHERE created_at >= since_from
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
commit;
