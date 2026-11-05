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
  c_winter_uplift constant numeric := 900;
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
    'WAVE2 Thermo',
    'Hunk Thermo BRFT W'
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
$function$
