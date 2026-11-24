'use strict';

// Update the catalogue and receive the photographed stock in the same statement.
// Only an inserted product or a transition from its previous photo can receive this lot.
module.exports = function receivedStockSql(records) {
  const data = JSON.stringify(records).replaceAll("'", "''");
  return `WITH lot AS (
  SELECT * FROM jsonb_to_recordset('${data}'::jsonb) AS r(
    uid text, title text, article text, color text, photo text, previous_photo text,
    position integer, stock jsonb, sizes jsonb, season text
  )
), created AS (
  INSERT INTO public.ulhome_products
    (uid, family, title, color_name, article, category, size_list, price, photo, sort_order, published, feed_enabled)
  SELECT uid, 'SaleOstatki', title, color, article, concat_ws(';', 'Розпродаж', season), sizes, 1990, photo, position, false, false
  FROM lot WHERE previous_photo IS NULL
  ON CONFLICT (uid) DO NOTHING
  RETURNING uid
), refreshed AS (
  UPDATE public.ulhome_products AS p
  SET photo = l.photo, sort_order = l.position, color_name = l.color, updated_at = now(),
      size_list = (
        SELECT jsonb_agg(s.value ORDER BY (s.value->>'eu')::integer)
        FROM (
          SELECT DISTINCT ON (value->>'eu') value
          FROM jsonb_array_elements(coalesce(p.size_list,'[]'::jsonb) || l.sizes)
               WITH ORDINALITY AS e(value, ordinal)
          ORDER BY value->>'eu', ordinal
        ) AS s
      )
  FROM lot AS l
  WHERE p.uid = l.uid AND p.family = 'SaleOstatki' AND p.price = 1990 AND p.photo = l.previous_photo
  RETURNING p.uid
), received AS (
  SELECT uid FROM created UNION ALL SELECT uid FROM refreshed
), stock_changes AS (
  INSERT INTO public.ulhome_sale_stock AS current_stock (uid, size, qty, title, price, sale_price)
  SELECT l.uid, s.key, s.value::integer, l.title || ' · ' || l.color, 1990, 1990
  FROM received JOIN lot AS l USING (uid)
  CROSS JOIN LATERAL jsonb_each_text(l.stock) AS s
  ON CONFLICT (uid, size) DO UPDATE
  SET qty = current_stock.qty + EXCLUDED.qty, updated_at = now()
  RETURNING uid, size
)
SELECT (SELECT count(*) FROM created) AS created, (SELECT count(*) FROM refreshed) AS refreshed,
       (SELECT count(*) FROM stock_changes) AS size_rows;`;
};
