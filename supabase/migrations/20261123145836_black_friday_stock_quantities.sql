CREATE OR REPLACE FUNCTION public.ulhome_reserve_black_friday_pairs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT item->>'uid' AS uid, item->>'size' AS size, count(*) AS line_count,
           min(CASE WHEN coalesce(item->>'qty','1') ~ '^[1-9][0-9]{0,8}$'
                    THEN coalesce(item->>'qty','1')::integer END) AS requested
    FROM jsonb_array_elements(NEW.items) AS lines(item)
    WHERE item->>'uid' LIKE 'bf26-%'
    GROUP BY item->>'uid', item->>'size'
    ORDER BY item->>'uid', item->>'size'
  LOOP
    IF pair.line_count <> 1 OR pair.requested IS NULL THEN
      RAISE EXCEPTION 'black_friday_unavailable';
    END IF;
    UPDATE public.ulhome_sale_stock
       SET qty = qty - pair.requested, updated_at = now()
     WHERE uid = pair.uid AND size = pair.size AND qty >= pair.requested;
    IF NOT FOUND THEN RAISE EXCEPTION 'black_friday_unavailable'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ulhome_reserve_black_friday_pairs() FROM PUBLIC, anon, authenticated;
