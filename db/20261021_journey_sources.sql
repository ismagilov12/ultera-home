begin;
CREATE OR REPLACE FUNCTION public.ulhome_analytics_sources_daily_v2(since_iso timestamp with time zone DEFAULT NULL::timestamp with time zone, top_n integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.ulhome_is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  WITH pv AS (
    SELECT
      to_char((created_at AT TIME ZONE 'Europe/Kyiv')::date, 'YYYY-MM-DD') AS day,
      session_id,
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN '(direct)'
        ELSE lower(regexp_replace(regexp_replace(referrer, '^https?://', ''), '/.*$', ''))
      END AS ref_host
    FROM public.ulhome_behavior_events
    WHERE event_type = 'page_view'
      AND (since_iso IS NULL OR created_at >= since_iso)
  ),
  sessions AS (
    SELECT day, session_id, MIN(ref_host) AS ref_host
    FROM pv
    GROUP BY day, session_id
  ),
  sess_by_src AS (
    SELECT day, ref_host, count(*)::bigint AS sessions
    FROM sessions
    GROUP BY day, ref_host
  ),
  orders_raw AS (
    SELECT
      to_char((created_at AT TIME ZONE 'Europe/Kyiv')::date, 'YYYY-MM-DD') AS day,
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN '(direct)'
        ELSE lower(regexp_replace(regexp_replace(referrer, '^https?://', ''), '/.*$', ''))
      END AS ref_host,
      total::numeric        AS total,
      keycrm_status_group   AS grp
    FROM public.ulhome_orders
    WHERE (since_iso IS NULL OR created_at >= since_iso)
      AND status = 'new'
  ),
  orders_by_src AS (
    SELECT
      day, ref_host,
      count(*)::bigint                                          AS orders,
      sum(total)::numeric                                       AS revenue,
      count(*) FILTER (WHERE grp='approved')::bigint            AS approved,
      count(*) FILTER (WHERE grp='rejected')::bigint            AS rejected,
      count(*) FILTER (WHERE grp='pending')::bigint             AS pending,
      sum(total) FILTER (WHERE grp='approved')::numeric         AS approved_revenue
    FROM orders_raw
    GROUP BY day, ref_host
  ),
  merged AS (
    SELECT
      COALESCE(s.day, o.day)            AS day,
      COALESCE(s.ref_host, o.ref_host)  AS ref_host,
      COALESCE(s.sessions, 0)::bigint   AS sessions,
      COALESCE(o.orders,   0)::bigint   AS orders,
      COALESCE(o.revenue,  0)::numeric  AS revenue,
      COALESCE(o.approved, 0)::bigint   AS approved,
      COALESCE(o.rejected, 0)::bigint   AS rejected,
      COALESCE(o.pending,  0)::bigint   AS pending,
      COALESCE(o.approved_revenue, 0)::numeric AS approved_revenue
    FROM sess_by_src s
    FULL OUTER JOIN orders_by_src o ON o.day = s.day AND o.ref_host = s.ref_host
  ),
  ranked AS (
    SELECT *,
      row_number() OVER (PARTITION BY day ORDER BY sessions DESC, orders DESC) AS rn
    FROM merged
  ),
  top_src AS (
    SELECT day, ref_host, sessions, orders, revenue, approved, rejected, pending, approved_revenue
    FROM ranked
    WHERE rn <= top_n
  ),
  rest_src AS (
    SELECT day,
           '(інші)'::text AS ref_host,
           COALESCE(sum(sessions),0)::bigint  AS sessions,
           COALESCE(sum(orders),0)::bigint    AS orders,
           COALESCE(sum(revenue),0)::numeric  AS revenue,
           COALESCE(sum(approved),0)::bigint  AS approved,
           COALESCE(sum(rejected),0)::bigint  AS rejected,
           COALESCE(sum(pending),0)::bigint   AS pending,
           COALESCE(sum(approved_revenue),0)::numeric AS approved_revenue
    FROM ranked
    WHERE rn > top_n
    GROUP BY day
    HAVING count(*) > 0
  ),
  combined AS (
    SELECT * FROM top_src
    UNION ALL
    SELECT * FROM rest_src
  ),
  by_day AS (
    SELECT
      day,
      jsonb_agg(
        jsonb_build_object(
          'ref_host',         ref_host,
          'sessions',         sessions,
          'orders',           orders,
          'revenue',          revenue,
          'approved',         approved,
          'rejected',         rejected,
          'pending',          pending,
          'approved_revenue', approved_revenue,
          'cr',
            CASE WHEN sessions>0 THEN round(orders::numeric*100/sessions, 2) ELSE 0 END,
          'approval_rate',
            CASE WHEN (approved+rejected)>0
              THEN round(approved::numeric*100/(approved+rejected), 2)
              ELSE NULL END
        )
        ORDER BY
          CASE WHEN ref_host='(інші)' THEN 1 ELSE 0 END,
          sessions DESC,
          orders   DESC
      ) AS sources,
      sum(sessions)::bigint     AS day_sessions,
      sum(orders)::bigint       AS day_orders,
      sum(revenue)::numeric     AS day_revenue,
      sum(approved)::bigint     AS day_approved,
      sum(rejected)::bigint     AS day_rejected,
      sum(pending)::bigint      AS day_pending,
      sum(approved_revenue)::numeric AS day_approved_revenue,
      CASE WHEN (sum(approved)+sum(rejected))>0
        THEN round(sum(approved)::numeric*100/(sum(approved)+sum(rejected)), 2)
        ELSE NULL END           AS day_approval_rate
    FROM combined
    GROUP BY day
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(bd) ORDER BY bd.day DESC), '[]'::jsonb)
  INTO result
  FROM by_day bd;

  RETURN jsonb_build_object('by_day', result);
END;
$function$
;
revoke all on function public.ulhome_analytics_sources_daily_v2(timestamptz,integer) from public,anon;
grant execute on function public.ulhome_analytics_sources_daily_v2(timestamptz,integer) to authenticated,service_role;
commit;
