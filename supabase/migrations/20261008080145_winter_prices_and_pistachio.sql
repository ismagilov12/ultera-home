-- Approved ULTERA October 8 catalog price/photo and winter surcharge update.
BEGIN;

DO $guard$
BEGIN
  PERFORM 1 FROM public.ulhome_products
  WHERE uid IN ('809858137952','454860479882','924701650982','550020260920')
  FOR UPDATE;
  IF (SELECT count(*) FROM public.ulhome_products
      WHERE (uid='809858137952' AND price=4190)
         OR (uid IN ('454860479882','924701650982') AND price=3790)) <> 3 THEN
    RAISE EXCEPTION 'Target product prices changed since review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ulhome_products
      WHERE uid='550020260920'
      AND photo='https://ultera.in.ua/photos/hunk-renew-pistachio-01-v4.png') THEN
    RAISE EXCEPTION 'Pistachio photo changed since review';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.compute_order_total(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item        jsonb;
  v_uid         text;
  v_qty         integer;
  v_promo_pct   numeric;
  v_db_price    numeric;
  v_db_family   text;
  v_sale_price  numeric;
  v_unit_price  numeric;
  v_season      text;
  v_uplift      numeric;
  v_total       numeric := 0;
  v_breakdown   jsonb := '[]'::jsonb;
  v_missing     text[] := array[]::text[];
  c_winter_uplift constant numeric := 700;
  c_no_season constant text[] := array[
    'SHAPE',
    'Lite',
    'Hunk Summer W',
    'Tees',
    'Insole',
    'SaleOstatki',
    'Thermo',
    'Hunk Thermo',
    'Aganta Thermo',
    'Thermo Ked',
    'Travel Thermo',
    'WAVE2 Thermo'
  ];
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'items must be a non-empty array', 'total', 0);
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_uid := v_item->>'uid';
    v_qty := greatest(coalesce((v_item->>'qty')::integer, 1), 1);

    v_promo_pct := coalesce((v_item->>'promo_pct')::numeric, 0);
    if v_promo_pct < 0 then v_promo_pct := 0; end if;
    if v_promo_pct > 90 then v_promo_pct := 90; end if;

    if v_uid is null or v_uid = '' then
      v_missing := array_append(v_missing, '(missing uid)');
      continue;
    end if;

    select price, family into v_db_price, v_db_family
    from public.ulhome_products
    where uid = v_uid
      and (published = true or family = 'Tees' or family = 'SaleOstatki' or family = 'Insole')
    limit 1;

    if v_db_price is null then
      v_missing := array_append(v_missing, v_uid);
      continue;
    end if;

    if v_promo_pct > 0 then
      select max(sale_price) into v_sale_price
      from public.ulhome_sale_stock
      where uid = v_uid and sale_price is not null and sale_price > 0;

      if v_sale_price is not null and v_sale_price > 0 then
        v_unit_price := v_sale_price;
      else
        v_unit_price := ceil((v_db_price * (100 - v_promo_pct) / 100.0) / 25.0) * 25;
      end if;
    else
      v_unit_price := v_db_price;
    end if;

    v_season := lower(coalesce(v_item->>'season_id', v_item->>'season', ''));
    v_uplift := 0;

    -- Catalog price is the final Autumn/Cordura price.
    -- Winter is the only selectable version with an extra charge.
    -- Legacy 'spring' is treated as Autumn for backwards compatibility.
    if (v_season = 'winter' or v_season like '%зим%')
       and not (coalesce(v_db_family, '') = any (c_no_season)) then
      v_uplift := c_winter_uplift;
      v_unit_price := v_unit_price + v_uplift;
    end if;

    v_total := v_total + (v_unit_price * v_qty);

    v_breakdown := v_breakdown || jsonb_build_object(
      'uid',           v_uid,
      'qty',           v_qty,
      'unit_price',    v_unit_price,
      'promo_pct',     v_promo_pct,
      'full_price',    v_db_price,
      'season_uplift', v_uplift,
      'line_total',    v_unit_price * v_qty
    );
  end loop;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Unknown or unpublished products',
      'missing', v_missing,
      'total', 0
    );
  end if;

  return jsonb_build_object(
    'ok',        true,
    'total',     v_total,
    'currency',  'UAH',
    'breakdown', v_breakdown
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ulhome_compute_order_total(p_items jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item jsonb;
  v_uid text;
  v_qty int;
  v_season text;
  v_base numeric;
  v_family text;
  v_extra numeric;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_uid := coalesce(v_item->>'uid', '');
    v_qty := greatest(coalesce(nullif(v_item->>'qty','')::int, 1), 1);
    v_season := coalesce(v_item->>'seasonId', '');

    if left(v_uid,5) = 'sale-' then
      select p into v_base from public.ulhome_sale_catalog where uid=v_uid and active=true limit 1;
      v_family := 'SaleOstatki';
    else
      select price, family into v_base, v_family from public.ulhome_products where uid=v_uid limit 1;
    end if;

    if v_base is null then
      raise exception 'Unknown product uid: %', v_uid;
    end if;

    -- Autumn is included; selectable winter thermo is +700 UAH.
    -- Legacy spring handling is retained for old cached storefront sessions until they expire.
    v_extra := case
      when v_season = 'winter'
        and coalesce(v_family, '') not in ('Thermo','Hunk Thermo','Aganta Thermo','Thermo Ked','Travel Thermo','WAVE2 Thermo') then 700
      when v_season = 'spring'
        and v_uid not in ('809858137952','924701650982','454860479882') then 700
      else 0
    end;

    v_total := v_total + ((v_base + v_extra) * v_qty);
  end loop;

  return v_total;
end;
$function$;


WITH new_prices(uid, price) AS (
  VALUES ('809858137952',4490::numeric),('454860479882',4190::numeric),('924701650982',4190::numeric)
)
UPDATE public.ulhome_products AS p
SET price=n.price,
    sizes=CASE WHEN jsonb_typeof(p.sizes)='array' THEN
      COALESCE((SELECT jsonb_agg(s.value || jsonb_build_object('price',to_char(n.price,'FM999999990.00')) ORDER BY s.ord)
       FROM jsonb_array_elements(p.sizes) WITH ORDINALITY AS s(value,ord)), '[]'::jsonb)
      ELSE p.sizes END,
    updated_at=now()
FROM new_prices AS n
WHERE p.uid=n.uid;

UPDATE public.ulhome_products
SET photo='https://ultera.in.ua/photos/hunk-renew-pistachio-01.webp', updated_at=now()
WHERE uid='550020260920'
  AND photo='https://ultera.in.ua/photos/hunk-renew-pistachio-01-v4.png';

DO $verify$
BEGIN
  IF (public.compute_order_total('[{"uid":"809858137952","qty":1,"season_id":"winter"}]'::jsonb)->>'total')::numeric <> 5190
     OR (public.compute_order_total('[{"uid":"924701650982","qty":1,"season_id":"winter"}]'::jsonb)->>'total')::numeric <> 4890
     OR (public.compute_order_total('[{"uid":"454860479882","qty":1,"season_id":"autumn"}]'::jsonb)->>'total')::numeric <> 4190
     OR (public.compute_order_total('[{"uid":"550020261003","qty":1,"season_id":"winter"}]'::jsonb)->>'total')::numeric <> 5500
  THEN RAISE EXCEPTION 'Post-migration pricing verification failed'; END IF;
END;
$verify$;

COMMIT;
